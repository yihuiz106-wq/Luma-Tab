# Luma Tab

Luma Tab 是一个用于替换 Chrome 新标签页的扩展，目标是把「常用页面、书签整理、轻量 AI 分类」放进一个安静、易用的工作台里。

项目当前基于 `React + TypeScript + Vite` 开发，并通过 Chrome Extension Manifest V3 运行。

## 功能特性

- 替换 Chrome 新标签页
- 读取并展示浏览器书签
- 支持手动创建分组、拖拽整理、重命名和删除书签
- 支持固定常用页面
- 根据最近访问记录生成 `Continue` 区域，方便继续上次工作
- 接入 DeepSeek，对书签进行 AI 分组和页面名称简化
- 支持导出 / 导入应用数据，便于迁移配置

## 技术栈

- React 18
- TypeScript
- Vite
- `@dnd-kit` 拖拽排序
- `lucide-react` 图标
- Chrome Extension Manifest V3

## 权限说明

扩展当前使用以下权限：

- `bookmarks`：读取和整理浏览器书签
- `storage`：保存分组、固定页面、缓存和 API Key
- `tabs`：配合页面打开与访问记录能力
- `https://api.deepseek.com/*`：调用 DeepSeek 接口进行 AI 分类

## 安装方式

### 方式一：加载已构建版本

仓库里已包含 `release/` 目录，可直接加载解压后的扩展：

1. 打开 Chrome 并访问 `chrome://extensions/`
2. 开启右上角 `Developer mode`
3. 点击 `Load unpacked`
4. 选择 `release/Luma-Tab-v1.0.1/` 目录

如果你使用压缩包，也可以先解压：

- `release/Luma-Tab-v1.0.0-unpacked.zip`

### 方式二：本地开发构建后加载

```bash
npm install
npm run build
```

构建完成后，在 Chrome 扩展页面加载构建产物目录即可。

提示：当前项目的发布产物位于 `release/`，如果你希望把 Vite 默认构建结果直接用于扩展加载，建议先确认构建输出目录与 `manifest.json`、背景脚本路径是否一致。

## 本地开发

安装依赖：

```bash
npm install
```

启动 Vite 开发环境：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

预览构建结果：

```bash
npm run preview
```

## 使用说明

### 1. 设置 DeepSeek API Key

打开新标签页后，点击右上角 `Settings`：

- 在 `API` 区域填入 DeepSeek API Key
- 点击 `Save Key` 保存
- 如需清除可点击 `Clear Key`

未配置 API Key 时，AI 分类相关功能不可用。

### 2. 整理书签

点击页面中的 `Edit` 按钮后可以：

- 新建分组
- 拖拽排序书签和分组
- 编辑书签标题、链接和描述
- 删除书签或取消本次草稿修改

### 3. 使用 AI 分类

在 `Edit` 面板的 `AI` 区域中：

- `Sort all`：对全部书签重新分组
- `Sort ungrouped`：仅整理未分组书签
- `Check`：先验证当前 AI 能力是否可用
- `Run`：执行 AI 分类

### 4. 迁移数据

在 `Settings` 的 `Data` 区域中：

- `Export`：导出当前配置与数据
- `Import`：导入之前导出的数据文件

这适合重装扩展、切换设备或备份分类结果时使用。

## 项目结构

```text
.
├── public/                 # 扩展清单、图标和静态资源
├── release/                # 已打包的发布版本
├── src/
│   ├── components/         # 左侧栏、右侧书签区、设置面板等 UI 组件
│   ├── lib/                # 存储、书签读取、背景图、DeepSeek 调用等能力
│   ├── types/              # 类型定义
│   ├── App.tsx             # 应用主入口
│   └── background.ts       # 扩展后台逻辑
├── package.json
└── vite.config.ts
```

## 发布说明

当前仓库内可见的发布产物包括：

- `release/Luma-Tab-v1.0.0/`
- `release/Luma-Tab-v1.0.1/`
- `release/Luma-Tab-v1.0.0-unpacked.zip`

如果要对外发布，建议在每次版本更新时同步：

- 更新 `public/manifest.json` 中的版本号
- 重新构建扩展资源
- 在 `release/` 下保留对应版本目录或压缩包

## 注意事项

- DeepSeek 能力依赖你自己的 API Key，相关费用与配额由你的 DeepSeek 账户决定
- API Key 当前保存在扩展本地存储中，适合个人使用场景
- 如果书签数量很多，首次 AI 分类可能需要更长时间

## License

当前仓库未声明开源许可证。如需开源发布，建议补充 `LICENSE` 文件。
