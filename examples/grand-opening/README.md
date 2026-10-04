# 「开业大吉」实跑案例

扫码内容是本公开仓库：`https://github.com/Cream-yj/artistic-qr-skill`。

这是先生成素材、再运行本仓库脚本组装的完整海报。使用亮金元宝、金条、红包、小金币、剪彩带与礼盒定位，保留原码的 41×41 矩阵及四模块静区。

## 成品

- [高清 JPG：2048×3072](poster-hd.jpg)
- [分享 JPG：1024×1536](poster-share.jpg)
- [小图 JPG：768×1152](poster-small.jpg)
- [金色适配前后对比](gold-comparison.jpg)：从左到右为旧适配、新适配、生成原稿。

金条的亮度处理保留 RGB 比例和高光；元宝仅加深两个正面区域，保留原轮廓与顶部光泽。功能暗格使用选定的小金币，组装结果没有临时纯色方块。

## 实际验码

| 实际 JPG | 默认 ZXing-C++ | Apple Vision | ZXing GlobalHistogram | jsQR |
| --- | --- | --- | --- | --- |
| poster-hd.jpg | 通过 | 通过 | 通过 | 失败 |
| poster-share.jpg | 通过 | 通过 | 通过 | 失败 |
| poster-small.jpg | 通过 | 通过 | 通过 | 失败 |

每个通过项均读出上述公开 URL。[verification.json](verification.json) 记录实际文件散列、尺寸、识别配置和逐项结果；报告由 `scripts/verify-qr.cjs` 对本目录实际 JPG 生成。GlobalHistogram 是 ZXing 的另一种配置，不算额外独立解码器。

这里展示电脑上的静态文件识别结果，真实手机、应用内缩放、压缩与印刷尚未实测。jsQR 的失败保留在记录中。

公开图片只展示本仓库的演示二维码；没有使用客户的导航二维码、个人照片、任务工作日志或私有链接。
