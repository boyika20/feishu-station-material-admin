# 分输站物资管理（飞书多维表格 · 边栏插件）

**GitHub：** https://github.com/boyika20/feishu-station-material-admin

多站点库存台账的 **PC 边栏插件**：跨站查货、调拨申请、**批量领用过账**（先写出库流水再扣现存量）。

> 单行日常领用请用多维表格原生「按钮」字段 + 自动化；本插件对齐「表内勾选 + 助手批量操作」。

## 协作策略

**本仓库不接受外部修改。** 不接收 Pull Request / Issue 协作；来件 PR 会被自动关闭。详见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。  
需要定制请自行 fork 到自己的账号维护。

## 安全

- 仓库内**无** Token、密钥、Base 链接、内网地址。  
- 运行时仅通过官方 JS SDK 访问用户当前打开的多维表格。  
- 请勿在 README / 截图中粘贴 Personal Base Token 或未脱敏的业务数据。

## 功能

1. **总览**：站点 / 库存行数 / 账面合计 / 进行中调拨  
2. **库存检索**：按站、名称、规格、编码、货位过滤  
3. **批量领用**：勾选多行 → 读取勾选 → 二次确认 → 写出库流水并扣库存（含并发账面校验）  
4. **跨站查货**：按名称+规格看各站可用量，一键填入调拨  
5. **调拨申请 / 审计 / 权限**：申请草稿与只读预览  

演示数据（虚构）：[`docs/DEMO-TEMPLATE.md`](docs/DEMO-TEMPLATE.md) · [`demo/`](demo/)

## 本地开发

```bash
npm install
npm run dev
npm run build
```

在多维表格 → 插件 → 自定义插件中，将服务地址指向本地或你自己托管的 `dist/`（URL 末尾保留 `/`）。

## 表结构约定

插件按**表名**查找（需与 Base 一致）：站点、站库存、入库流水、出库流水、调拨申请、人员站点权限、修改记录。详见 [`docs/OPS.md`](docs/OPS.md)。

## 技术栈

- React 18 + Vite + TypeScript  
- `@lark-base-open/js-sdk`

## License

MIT（允许自行 fork 使用；上游不合并外部贡献）
