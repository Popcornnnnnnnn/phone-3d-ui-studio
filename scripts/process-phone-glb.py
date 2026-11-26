"""Headless Blender pipeline to inspect, normalize, optimize, and render preview PNGs of CC-BY GLB phone models."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "assets-raw"
OUT_DIR = REPO_ROOT / "public" / "models"
PREVIEW_DIR = Path("/tmp/phone-previews")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.type == "MESH"]


def world_bounds(objs: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objs:
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, w.x)
            mins.y = min(mins.y, w.y)
            mins.z = min(mins.z, w.z)
            maxs.x = max(maxs.x, w.x)
            maxs.y = max(maxs.y, w.y)
            maxs.z = max(maxs.z, w.z)
    return mins, maxs


def tri_count(obj: bpy.types.Object) -> int:
    return sum(max(1, len(p.vertices) - 2) for p in obj.data.polygons)


def inspect_file(path: Path) -> dict:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()

    meshes = mesh_objects()
    mins, maxs = world_bounds(meshes)
    size = maxs - mins

    mesh_info = []
    for obj in meshes:
        omins, omaxs = world_bounds([obj])
        osize = omaxs - omins
        mats = [m.name if m else None for m in obj.data.materials]
        mesh_info.append({
            "name": obj.name,
            "tris": tri_count(obj),
            "mats": mats,
            "min": [round(v, 5) for v in omins],
            "max": [round(v, 5) for v in omaxs],
            "size": [round(v, 5) for v in osize],
        })

    mat_info = []
    for mat in bpy.data.materials:
        info = {"name": mat.name, "users": mat.users, "textures": []}
        if mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    bc = node.inputs["Base Color"].default_value
                    info["baseColor"] = [round(float(x), 3) for x in bc[:4]]
                    info["metallic"] = round(float(node.inputs["Metallic"].default_value), 3)
                    info["roughness"] = round(float(node.inputs["Roughness"].default_value), 3)
                elif node.type == "TEX_IMAGE" and node.image:
                    info["textures"].append({
                        "image": node.image.name,
                        "size": list(node.image.size),
                    })
        mat_info.append(info)

    return {
        "file": path.name,
        "totalTris": sum(m["tris"] for m in mesh_info),
        "boundsMin": [round(v, 5) for v in mins],
        "boundsMax": [round(v, 5) for v in maxs],
        "size": [round(v, 5) for v in size],
        "meshCount": len(mesh_info),
        "meshes": mesh_info,
        "materials": mat_info,
    }


def apply_rotation_to_all(rot_mat_3x3: Matrix) -> None:
    rot4 = rot_mat_3x3.to_4x4()
    # Apply to root objects only so child transforms rotate uniformly once.
    roots = [o for o in bpy.data.objects if o.parent is None]
    for obj in roots:
        obj.matrix_world = rot4 @ obj.matrix_world
    bpy.context.view_layer.update()


def bake_transforms_and_unparent() -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(bpy.data.objects):
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()


def downscale_images(max_dim: int = 512, drop_images: set[str] | None = None) -> None:
    drop_images = drop_images or set()
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for node in list(mat.node_tree.nodes):
            if node.type == "TEX_IMAGE" and node.image and node.image.name in drop_images:
                mat.node_tree.nodes.remove(node)

    for img in list(bpy.data.images):
        if img.name in drop_images:
            continue
        w, h = img.size[0], img.size[1]
        if w > max_dim or h > max_dim:
            scale = max_dim / max(w, h)
            nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
            img.scale(nw, nh)
        img.file_format = "JPEG"


def decimate_dense_meshes(tri_budget: int = 4000, ratio_floor: float = 0.2) -> None:
    for obj in mesh_objects():
        tris = tri_count(obj)
        if tris <= tri_budget:
            continue
        ratio = max(ratio_floor, tri_budget / tris)
        mod = obj.modifiers.new(name="OptimizeDecimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)


def make_matte_black_material(name: str) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.015, 0.017, 0.022, 1.0)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.72
    return mat


def set_material_base_color(mat: bpy.types.Material, rgba: tuple[float, float, float, float], metallic: float | None = None, roughness: float | None = None) -> None:
    if not mat or not mat.node_tree:
        return
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return
    bsdf.inputs["Base Color"].default_value = rgba
    if metallic is not None:
        bsdf.inputs["Metallic"].default_value = metallic
    if roughness is not None:
        bsdf.inputs["Roughness"].default_value = roughness


def find_obj_by_material(mat_name: str) -> list[bpy.types.Object]:
    return [o for o in mesh_objects() if any(m and m.name == mat_name for m in o.data.materials)]


def center_and_normalize(
    xy_objs: list[bpy.types.Object],
    front_objs: list[bpy.types.Object],
    back_objs: list[bpy.types.Object],
    screen_objs: list[bpy.types.Object] | None = None,
) -> dict:
    b_min, b_max = world_bounds(xy_objs)
    cx = (b_min.x + b_max.x) / 2.0
    cy = (b_min.y + b_max.y) / 2.0
    _, f_max = world_bounds(front_objs)
    bk_min, _ = world_bounds(back_objs)
    cz = (bk_min.z + f_max.z) / 2.0
    body_h = b_max.y - b_min.y
    scale = 1.0 / body_h

    for obj in mesh_objects():
        mesh = obj.data
        for v in mesh.vertices:
            v.co.x = (v.co.x - cx) * scale
            v.co.y = (v.co.y - cy) * scale
            v.co.z = (v.co.z - cz) * scale
        mesh.update()
    bpy.context.view_layer.update()

    nb_min, nb_max = world_bounds(xy_objs)
    _, n_front_max = world_bounds(front_objs)
    n_back_min, _ = world_bounds(back_objs)

    screen_info = None
    if screen_objs:
        s_min, s_max = world_bounds(screen_objs)
        screen_info = {
            "width": round(float(s_max.x - s_min.x), 6),
            "height": round(float(s_max.y - s_min.y), 6),
            "centerY": round(float((s_min.y + s_max.y) / 2.0), 6),
            "z": round(float(s_max.z), 6),
        }

    return {
        "bodyWidth": round(float(nb_max.x - nb_min.x), 6),
        "bodyHeight": round(float(nb_max.y - nb_min.y), 6),
        "bodyDepth": round(float(n_front_max.z - n_back_min.z), 6),
        "frontGlassZ": round(float(n_front_max.z), 6),
        "backBodyZ": round(float(n_back_min.z), 6),
        "screen": screen_info,
        "totalTris": sum(tri_count(o) for o in mesh_objects()),
    }


def render_preview(out_png: Path) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 640
    scene.render.image_settings.file_format = "PNG"

    world = bpy.data.worlds.new("StudioWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.14, 0.16, 0.20, 1.0)
        bg.inputs[1].default_value = 2.0

    lights = [
        ("KeyLight", "AREA", (1.6, 1.4, 2.2), (math.radians(48), 0, math.radians(-30)), 220.0, 2.0),
        ("BackFill", "AREA", (0.0, 0.8, 2.8), (math.radians(78), 0, 0), 140.0, 2.5),
        ("RimLight", "AREA", (-1.8, 0.6, 1.2), (math.radians(72), 0, math.radians(52)), 160.0, 1.8),
    ]
    for name, ltype, loc, rot, energy, size in lights:
        ldata = bpy.data.lights.new(name=name, type=ltype)
        ldata.energy = energy
        if hasattr(ldata, "size"):
            ldata.size = size
        lobj = bpy.data.objects.new(name=name, object_data=ldata)
        lobj.location = loc
        lobj.rotation_euler = rot
        scene.collection.objects.link(lobj)

    originals = list(mesh_objects())
    for obj in originals:
        obj.rotation_mode = "XYZ"
        obj.location = (-0.72, 0.0, 0.0)
        obj.rotation_euler = (0.0, math.radians(18.0), 0.0)

    # Back 3/4 view (158 deg around Y) and Side profile view (-75 deg around Y)
    for offset_x, yaw_deg in [(0.0, 158.0), (0.68, -75.0)]:
        for obj in originals:
            dup = obj.copy()
            dup.data = obj.data
            dup.rotation_mode = "XYZ"
            dup.location = (offset_x, 0.0, 0.0)
            dup.rotation_euler = (0.0, math.radians(yaw_deg), 0.0)
            scene.collection.objects.link(dup)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 36
    cam_obj = bpy.data.objects.new("PreviewCam", cam_data)
    cam_obj.rotation_mode = "XYZ"
    cam_obj.location = (0.0, 0.05, 2.4)
    cam_obj.rotation_euler = (0.0, 0.0, 0.0)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    out_png.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_png)
    bpy.ops.render.render(write_still=True)


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=True,
        export_yup=False,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=82,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )


def process_iphone_17_pro() -> dict:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(RAW_DIR / "iphone_17_pro.glb"))
    bpy.context.view_layer.update()

    # Source: screen=+Y, top=+Z -> Ry(pi) @ Rx(-pi/2): (x,y,z) -> (-x, z, y)
    rot = Matrix.Rotation(math.pi, 3, "Y") @ Matrix.Rotation(-math.pi / 2, 3, "X")
    apply_rotation_to_all(rot)
    bake_transforms_and_unparent()

    # Remove Dynamic Island pill and push source OLED screen slightly back as dark backing (no wallpaper).
    drop_tex = set()
    oled_mat = bpy.data.materials.get("OLED")
    if oled_mat and oled_mat.node_tree:
        for n in oled_mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                drop_tex.add(n.image.name)

    matte_screen = make_matte_black_material("Screen_Backing")
    screen_objs = []
    for obj in list(mesh_objects()):
        mat_names = {m.name for m in obj.data.materials if m}
        if "OLED_off" in mat_names:
            bpy.data.objects.remove(obj, do_unlink=True)
        elif "OLED" in mat_names:
            obj.data.materials.clear()
            obj.data.materials.append(matte_screen)
            for v in obj.data.vertices:
                v.co.z -= 0.0005
            obj.data.update()
            screen_objs.append(obj)
        elif "Glass" in mat_names:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Ensure Frosted_glass and Anodized_aluminum render with neutral crisp finish ready for tinting
    fg_mat = bpy.data.materials.get("Frosted_glass")
    set_material_base_color(fg_mat, (0.28, 0.29, 0.32, 1.0), metallic=0.05, roughness=0.38)
    gt_mat = bpy.data.materials.get("Glass_tint")
    set_material_base_color(gt_mat, (0.24, 0.25, 0.28, 1.0), metallic=0.05, roughness=0.35)
    al_mat = bpy.data.materials.get("Anodized_aluminum")
    set_material_base_color(al_mat, (0.34, 0.35, 0.38, 1.0), metallic=0.88, roughness=0.22)

    downscale_images(max_dim=512, drop_images=drop_tex)
    decimate_dense_meshes(tri_budget=6000, ratio_floor=0.35)

    chassis_xy = [o for o in mesh_objects() if o.name in ("Object_4", "Object_20")]
    front = [o for o in mesh_objects() if o.name in ("Object_4", "Object_20")]
    back = [o for o in mesh_objects() if o.name == "Object_17"]
    stats = center_and_normalize(chassis_xy or mesh_objects(), front, back, screen_objs)

    out_glb = OUT_DIR / "iphone-17-pro.glb"
    export_glb(out_glb)
    render_preview(PREVIEW_DIR / "iphone-17-pro.png")
    stats["fileBytes"] = out_glb.stat().st_size
    stats["file"] = out_glb.name
    return stats


def process_iphone_16() -> dict:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(RAW_DIR / "iphone_16_black.glb"))
    bpy.context.view_layer.update()

    rot = Matrix.Rotation(math.pi, 3, "Y") @ Matrix.Rotation(-math.pi / 2, 3, "X")
    apply_rotation_to_all(rot)
    bake_transforms_and_unparent()

    # Screen wallpaper material: FTRPXsQynaenYUI (Image_12). Front Dynamic Island planes: Object_296, 302, 305, 308.
    # Screen glass sheet: Object_293 (0 thickness flat plane at max Z) & Object_311 (bezel lip).
    # Screen plane: Object_299 (FTRPXsQynaenYUI).
    drop_tex = set()
    wp_mat = bpy.data.materials.get("FTRPXsQynaenYUI")
    if wp_mat and wp_mat.node_tree:
        for n in wp_mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                drop_tex.add(n.image.name)

    matte_screen = make_matte_black_material("Screen_Backing")
    screen_objs = []
    for obj in list(mesh_objects()):
        mat_names = {m.name for m in obj.data.materials if m}
        # Remove source Dynamic Island flat decals & flat glass cover sheet (size.z ~ 0) so our live ScreenSurface shows cleanly
        bmin, bmax = world_bounds([obj])
        bsize = bmax - bmin
        if "FTRPXsQynaenYUI" in mat_names:
            obj.data.materials.clear()
            obj.data.materials.append(matte_screen)
            for v in obj.data.vertices:
                v.co.z -= 0.015
            obj.data.update()
            screen_objs.append(obj)
        elif obj.name in ("Object_293", "Object_296", "Object_302", "Object_305", "Object_308"):
            bpy.data.objects.remove(obj, do_unlink=True)
        elif bsize.z < 0.002 and bmin.z > 0.35 and bsize.x < 3.0:
            # Tiny flat decals floating on front glass
            bpy.data.objects.remove(obj, do_unlink=True)

    # Improve metallic contrast on frame/back glass for dark-space readability & finish tinting
    frame_mat = bpy.data.materials.get("SNEsafZygRmlhRr")
    set_material_base_color(frame_mat, (0.26, 0.28, 0.31, 1.0), metallic=0.85, roughness=0.25)
    back_mat = bpy.data.materials.get("imSnhDbpTQibpde")
    set_material_base_color(back_mat, (0.18, 0.19, 0.22, 1.0), metallic=0.05, roughness=0.36)
    bump_mat = bpy.data.materials.get("FpuaJVrjAsixZjs")
    set_material_base_color(bump_mat, (0.20, 0.21, 0.24, 1.0), metallic=0.1, roughness=0.28)

    downscale_images(max_dim=512, drop_images=drop_tex)
    decimate_dense_meshes(tri_budget=5000, ratio_floor=0.45)

    chassis_xy = [o for o in mesh_objects() if o.name in ("Object_263", "Object_251", "Object_311")]
    front = [o for o in mesh_objects() if o.name == "Object_311"]
    back = [o for o in mesh_objects() if o.name == "Object_263"]
    stats = center_and_normalize(chassis_xy or mesh_objects(), front, back, screen_objs)

    out_glb = OUT_DIR / "iphone-16.glb"
    export_glb(out_glb)
    render_preview(PREVIEW_DIR / "iphone-16.png")
    stats["fileBytes"] = out_glb.stat().st_size
    stats["file"] = out_glb.name
    return stats


def process_iphone_16_pro() -> dict:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(RAW_DIR / "iphone_16_pro_max.glb"))
    bpy.context.view_layer.update()

    # Source: screen=-X, top=+Z -> R rows: (0,-1,0), (0,0,1), (-1,0,0)
    rot = Matrix(((0.0, -1.0, 0.0), (0.0, 0.0, 1.0), (-1.0, 0.0, 0.0)))
    apply_rotation_to_all(rot)
    bake_transforms_and_unparent()

    drop_tex = set()
    scr_mat = bpy.data.materials.get("screen.001")
    if scr_mat and scr_mat.node_tree:
        for n in scr_mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                drop_tex.add(n.image.name)

    matte_screen = make_matte_black_material("Screen_Backing")
    screen_objs = []
    for obj in list(mesh_objects()):
        mat_names = {m.name for m in obj.data.materials if m}
        if obj.name.startswith("Cube.016") or obj.name == "Cube.014_glass.002_0":
            bpy.data.objects.remove(obj, do_unlink=True)
        elif "screen.001" in mat_names:
            obj.data.materials.clear()
            obj.data.materials.append(matte_screen)
            for v in obj.data.vertices:
                v.co.z -= 0.004
            obj.data.update()
            screen_objs.append(obj)

    # Normalize titanium frame & back glass color (source has bronze/desert tint -> neutral titanium base so finish tinting works cleanly!)
    frame_mat = bpy.data.materials.get("metalframe.002")
    set_material_base_color(frame_mat, (0.42, 0.43, 0.46, 1.0), metallic=0.88, roughness=0.22)
    back_mat = bpy.data.materials.get("basecolor.001")
    set_material_base_color(back_mat, (0.28, 0.29, 0.32, 1.0), metallic=0.05, roughness=0.35)
    logo_mat = bpy.data.materials.get("apple_logo.001")
    set_material_base_color(logo_mat, (0.55, 0.56, 0.60, 1.0), metallic=0.85, roughness=0.14)

    downscale_images(max_dim=512, drop_images=drop_tex)
    decimate_dense_meshes(tri_budget=3000, ratio_floor=0.08)

    chassis_xy = [o for o in mesh_objects() if o.name in ("Cube.014_metalframe.002_0", "Cube.014_basecolor.001_0", "Cube.014_black.002_0")]
    front = [o for o in mesh_objects() if o.name in ("Cube.014_black.002_0", "Cube.014_metalframe.002_0")]
    back = [o for o in mesh_objects() if o.name == "Cube.014_basecolor.001_0"]
    stats = center_and_normalize(chassis_xy or mesh_objects(), front, back, screen_objs)

    out_glb = OUT_DIR / "iphone-16-pro.glb"
    export_glb(out_glb)
    render_preview(PREVIEW_DIR / "iphone-16-pro.png")
    stats["fileBytes"] = out_glb.stat().st_size
    stats["file"] = out_glb.name
    return stats


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", nargs="+", help="GLB paths to inspect")
    parser.add_argument("--process-all", action="store_true", help="Process all 3 models into public/models/")
    args = parser.parse_args(argv)

    if args.inspect:
        results = [inspect_file(Path(p)) for p in args.inspect]
        print("INSPECT_JSON_START")
        print(json.dumps(results, indent=2))
        print("INSPECT_JSON_END")
    elif args.process_all:
        summary = [
            process_iphone_17_pro(),
            process_iphone_16(),
            process_iphone_16_pro(),
        ]
        print("PROCESS_SUMMARY_START")
        print(json.dumps(summary, indent=2))
        print("PROCESS_SUMMARY_END")


if __name__ == "__main__":
    main()
