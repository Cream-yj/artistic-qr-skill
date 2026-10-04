# 素材适配、组装与统一验码脚本

这些本地脚本处理确定性部分；主题物件和背景仍由图像工具生成。它们不会调用图像模型、重编码二维码或上传输入与结果。

## 安装或复用依赖

在仓库目录执行：

```bash
npm install
python3 -m pip install -r requirements.txt
```

可以复用已经存在的环境：`ARTISTIC_QR_NODE_MODULES` 指向包含 `sharp`/`jsqr` 的依赖目录，`PYTHON` 指定 Python；Python 的库搜索路径遵循当前环境。脚本没有固定工作区路径。

## 1. 适配选定素材

```bash
node scripts/adapt-assets.cjs local/assets-input.json --out local/adapted
```

输入 PNG 或自包含 SVG，每件输出独立 SVG、透明 PNG，以及 `assets.json`。PNG 原稿不会被覆盖；含照片的 SVG 必须仍注明位图。SVG 不支持脚本、外部图片或外部引用。

示例清单：

```json
{
  "assets": [
    {"id": "ruby-coin", "file": "coin.png", "grid": [1, 1]},
    {"id": "gift-finder", "file": "finder.svg", "grid": [7, 7]},
    {"id": "gift-alignment", "file": "alignment.svg", "grid": [5, 5]},
    {
      "id": "gold-bar", "file": "bar.png", "grid": [2, 1],
      "tone": {"shadow_gamma": 1.35, "highlight_start": 0.82}
    }
  ],
  "roles": {
    "point": "ruby-coin",
    "function": "ruby-coin",
    "h2": "gold-bar",
    "finder": "gift-finder",
    "alignment": "gift-alignment"
  }
}
```

文件路径相对清单文件，不需要复制成某个机器路径。角色映射只使用已选素材：

| 角色 | 用于 |
| --- | --- |
| `point` | 1×1 数据格；必需，可指定多种颜色的 ID 数组 |
| `function` | 时序、格式、版本等功能暗格；必需、独立显式选择，可引用已选单点 |
| `h2` / `h3` / `h4` | 2、3、4 格横条；可选 |
| `v2` / `v3` | 2、3 格竖条；可选 |
| `block2` | 2×2 满块；可选 |
| `bend` | 2×2 中缺右上格的 L；可选，组装时按缺格方向旋转 |
| `finder` | 7×7 主定位；必需，可指定混色数组 |
| `alignment` | 5×5 校正；源矩阵需要时必需，单独适配 |

没有指定某个组合角色时，用已选单点填充剩余数据暗格。缺少功能格素材时直接报错，不会插入未经选择的普通方块。

### 金属明暗

`shadow_gamma: 1` 保持原亮度。大于 1 时按亮度计算同一 RGB 增益，保留通道比例；接近白色的亮部逐渐恢复原增益。`highlight_start` 是开始保护亮部的归一化亮度，范围 0.5–0.99。默认不做亮度修改，不自动选择一个所谓“可扫金色”。

可限定自然阴影/正面区域，例如：

```json
{
  "shadow_gamma": 1.5,
  "highlight_start": 0.85,
  "regions": [[[0.15, 0.4], [0.85, 0.4], [0.85, 0.8], [0.15, 0.8]]],
  "feather": 0.03
}
```

坐标相对原稿宽高。区域外不变，区域边缘可羽化；先看材质，再测成品。高光恰好处在模块中心时，保护高光并不能解决识别问题；可以先移动或压缩亮面所在的几何区域，让关键采样位置落在原素材的自然阴影面。不要继续把整件金属压暗。

确实需要加深指定的自然阴影面时，可设置 `shadow_gain`（0.4–1）；它仅允许与明确的 `regions` 一起使用，区域外的材质保持原样。不要把区域写成整张图来规避这个限制，也不要用形变通过验码后省略对物件失真的视觉检查。

### 形态与定位

`patches` 将原素材的一部分映射到目标的一部分。`source`、`target` 都是 `[x,y,width,height]` 的归一化矩形，必须在各自边界内。相邻切片共享源边界可保持纹理连续；各切片可指定自己的 `tone` 或 `lighten`（浅内衬提亮量 0–0.6）。

L 形示例，目标右上格保持透明：

```json
{
  "id": "ribbon", "file": "ribbon.png", "grid": [2, 2],
  "patches": [
    {"source": [0, 0, 0.34, 0.73], "target": [0, 0, 0.5, 0.5]},
    {"source": [0, 0.73, 0.34, 0.27], "target": [0, 0.5, 0.5, 0.5]},
    {"source": [0.34, 0.73, 0.66, 0.27], "target": [0.5, 0.5, 0.5, 0.5]}
  ]
}
```

源边界必须从本次素材实际测量，示例的 0.34/0.73 不是通用裁切位置。礼盒同理：主定位目标边界按 `[0,1,2,5,6,7]/7`，校正目标边界按 `[0,1,2,3,4,5]/5`；测量盒壁、内衬、礼物边界后形成切片。避免亮锁扣和大蝴蝶结打断中心扫描路径。单独元素仍不能证明可扫。

## 2. 按原矩阵组装

```bash
node scripts/assemble-qr.cjs local/poster.json
```

配置例：

```json
{
  "matrix": "matrix.json",
  "assets": "adapted/assets.json",
  "module_size": 24,
  "quiet_zone_modules": 4,
  "coverage": 0.96,
  "export_widths": [1176, 980],
  "output": "poster"
}
```

矩阵输入是**不含静区**的平方 0/1 JSON 数组，或含 `matrix` 字段的对象。必须来自可靠的原码提取；脚本不会从扫码内容重编码。矩阵合法尺寸不代表内容可扫，先做原码基线检测。

脚本按实际版本计算功能区、三个主定位和需要的所有校正图案。输出组合 SVG、无损 PNG、实际 JPG 和布局记录。`primitive_fallback_count` 必须为 0，功能格记录实际使用的元素 ID。

海报底图可用自包含 `base_layer` SVG；另设 `width`、`height`、`origin: [x,y]`。底图应预留四模块静区，已有标题/底图只在原范围内保留。布局边界检查不能证明底图没有杂物，仍需目视检查及整体扫码。

已有作品仅修素材时，可在配置中提供 `placements`：每项包含选定的 `asset`、`x/y/w/h`、实际 `cells`，可选 `angle`（0/90/180/270）。脚本检查重复、暗/浅格和功能区，保持既有排版；输入的占格记录并不能证明图片轮廓没有侵入邻格。JPG 始终从当前无损母版导出。

## 3. 统一验证实际文件

```bash
node scripts/verify-qr.cjs local/poster-1176.jpg local/poster-980.jpg \
  --expected-file local/payload.txt --out local/validation.json \
  --require zxing,vision
```

默认检测 ZXing 默认配置、独立 Apple Vision、jsQR，以及 ZXing GlobalHistogram。后者是诊断配置，不增加独立解码器数。默认 CLI 成功退出条件只要求 `zxing`；Skill 的主要验收仍需一条独立路径。macOS 可要求 `zxing,vision`，其他环境可选择已具备的独立路径，但不能隐藏未通过的已执行项。

- `--engines zxing,vision,jsqr,global` 控制实际执行项。
- `--require zxing,vision` 控制必须通过的项；只能指定已执行的引擎。
- `--python ...` 指定可用 Python；`--jsqr-path ...` 可复用本地已有 jsQR。
- macOS 自动从本仓库 Objective-C 源码编译 Vision 助手；`--vision-bin ...` 可复用本机已有兼容助手。沙箱阻止 Vision 启动时记录运行错误，按当前执行环境授权规则处理，不把错误算成解码失败。
- `--expected-file` 读取准确内容，去除文件末尾一个文本换行；需要精确保留结尾换行的内容可用 `--expected`。
- `pass`：确实读出期望内容；`fail`：执行完成但未读出正确内容；`not_tested`：缺少能力；`error`：执行错误。
- 退出码 0：所有必测项通过；1：必测项存在未通过/未执行/错误；2：输入或调用错误。

报告包含实际文件散列、宽高、配置、工具版本及逐项读取内容。报告也可能含真实二维码链接，默认本地保存；脚本不自动上传报告。不要把 `all_required_passed` 解释成所有识别器或所有手机都通过。

## 本地回归

```bash
npm test
```

测试实际检查亮部、RGB 比例、透明边缘、局部区域、不合法裁切，以及版本 1/7 的组装与实际 JPG 解码。夹具只编码 `A` 和 `https://example.org`，不是用户二维码。依赖缺项需显式跳过相应解码测试，不能充当已验码结果。
