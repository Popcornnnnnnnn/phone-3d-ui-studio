import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [directory] = process.argv.slice(2)
if (!directory || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/quality-report.mjs QUALITY_OUTPUT_DIR')
}
const root = resolve(directory)
const data = JSON.parse(readFileSync(join(root, 'metrics.json'), 'utf8'))
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])
const rows = data.results.map(r => `<tr><td>${r.targetMbps} Mbps / ${escape(r.tuning)}</td>${r.frames.map(f =>
  `<td>${f.vsPreEncode.lumaSSIM8x8.toFixed(4)}<br>RMSE ${f.vsPreEncode.rgbRMSE.toFixed(2)}</td>`).join('')}</tr>`).join('')
const figures = [{ label: '编码前 · 同尺寸 NV12 参考', image: 'pre-encode-nv12.png' },
  ...data.results.flatMap(r => r.frames.filter(f => f.frame !== 59).map(f => ({
    label: `${r.targetMbps} Mbps / ${r.tuning} / ${f.frame === 0 ? '首帧' : '连续编码 120 帧后'}`, image: f.image,
  })))].map(f => `<figure><figcaption>${escape(f.label)}</figcaption><a href="${escape(f.image)}"><img src="${escape(f.image)}" alt="${escape(f.label)}"></a></figure>`).join('')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无线画质 · 编码环节对照</title>
<style>body{font:16px/1.65 system-ui;background:#f7f8fa;color:#172333;margin:32px auto;max-width:1400px;padding:0 24px}h1{font-size:28px}p{max-width:1000px}table{border-collapse:collapse;margin:24px 0}td,th{padding:10px 20px;border:1px solid #ccd3dd;text-align:left}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}figure{margin:0;background:white;padding:12px;border:1px solid #dce1e8}figcaption{font-weight:600;min-height:54px}img{display:block;width:100%;height:auto}code{background:#e8edf3;padding:2px 5px}</style>
<h1>编码环节画质对照</h1><p>使用用户提供的同一张截图、同一份生产 H.264 编码器代码，在 Mac 上离线回放。仅用于定位编码损失，不能代表 iPhone 采集、无线稳定性或浏览器显示。所有图片仅保存在本机。</p>
<p>所有方案均为 ${data.width} × ${data.height}，目标 60 fps，连续输入 120 个相同画面。首帧与静态收敛后的画面必须分别看：后者并不证明真实屏幕共享会发送同样多的静态帧。默认策略表示系统默认，不等同于明确关闭速度优先。</p>
<p>SSIM8x8 越接近 1 越相似；RMSE 越小越好。评分与同尺寸编码前参考比较，排除缩放损失。颜色说明：${escape(data.decoderColorimetry ?? '早期诊断版本，颜色转换尚未校验')}。数值不能替代肉眼验收。</p>
<table><thead><tr><th>配置</th><th>首帧</th><th>第 60 帧</th><th>第 120 帧</th></tr></thead><tbody>${rows}</tbody></table>
<p>点击图片可打开完整分辨率。对照云层、蓝色渐变、文件夹边缘和小字；不同阶段的图片不要混为同一次画质结论。</p><div class="grid">${figures}</div></html>`
writeFileSync(join(root, 'comparison.html'), html, { flag: 'wx' })
console.log(join(root, 'comparison.html'))
