# Phone 3D UI Studio

A reusable desktop studio for presenting a phone UI on a controllable 3D device, with camera presets, lighting, backgrounds, recording, and—after the content-production MVP is stable—live screen and device-pose synchronization.

- GitHub repository: <https://github.com/Popcornnnnnnnn/phone-3d-ui-studio>
- Delivery board: <https://github.com/users/Popcornnnnnnnn/projects/3>

## Project status

- Phase: project setup and technical validation
- Baseline start: 2026-09-02
- Target content-production MVP: 2026-09-18
- Target live-sync release candidate: 2026-10-09
- Target acceptance: 2026-10-12
- Active work: [M0 — establish runnable project foundation](https://github.com/Popcornnnnnnnn/phone-3d-ui-studio/issues/1)

The schedule assumes one primary developer, a Mac and iPhone available for testing, and no App Store release requirement. See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the estimate, gates, and acceptance criteria.

## Product boundary

The project deliberately separates two deliverables:

1. **Content-production MVP** — prerecorded phone-screen video on a 3D phone, reusable studio presets, camera motion, and recording.
2. **Live-sync extension** — live phone-screen transport and real-device orientation synchronization.

The first deliverable is independently useful and does not wait for iOS capture constraints to be solved.

## Repository structure

```text
docs/                  Architecture and decision records
.github/               Issue templates and project automation metadata
PROJECT_PLAN.md        Schedule, milestones, effort, risks, acceptance gates
ROADMAP.md             Date-based delivery checkpoints
```

Application code will be introduced during the foundation milestone after the renderer and capture-spike decisions are recorded.

## Working rules

- Keep source, generated media, captured phone content, secrets, and build caches separate.
- Never commit captured personal phone screens, signing material, provisioning profiles, `.env` files, or recordings.
- A visually convincing render is not proof that live capture or pose synchronization works.
- Every milestone closes only after its acceptance check is recorded in the corresponding GitHub issue.
