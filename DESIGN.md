---
name: Chatgame
description: 让剧本成为主角的玩家游戏宿主
colors:
  house-black: "#10110f"
  house-surface: "#1b1d1a"
  house-raised: "#272924"
  programme-paper: "#efe9dc"
  programme-muted: "#aaa69d"
  house-brass: "#c6a15b"
  house-focus: "#8ec9ba"
  house-danger: "#d66a55"
typography:
  headline:
    fontFamily: "ui-sans-serif, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 4.75rem)"
    fontWeight: 720
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  body:
    fontFamily: "ui-sans-serif, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  title:
    fontFamily: "ui-sans-serif, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(1.35rem, 2.5vw, 2rem)"
    fontWeight: 650
    lineHeight: 1.15
  label:
    fontFamily: "ui-sans-serif, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 620
    lineHeight: 1.35
  status:
    fontFamily: "ui-sans-serif, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 620
    lineHeight: 1.35
rounded:
  control: "12px"
  surface: "14px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "36px"
components:
  button-primary:
    backgroundColor: "{colors.programme-paper}"
    textColor: "{colors.house-black}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "14px 18px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.house-raised}"
    textColor: "{colors.programme-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "14px 18px"
    height: "48px"
---

# Design System: Chatgame

## Overview

**Creative North Star: “剧目单后台”**

宿主像一座小型剧场的节目板：当前剧本是当晚唯一主节目，封面、标题与世界状态先于管理工具出现；开始、继续与选择存档像清晰的入场动作，剧本库和设置退到后台。宿主本身保持平面、安静、可靠，让每个剧本接管大块视觉区域而不争夺主题表达。

这不是流媒体卡片墙，也不是开发控制台。页面用单一主视觉、窄操作列、明确的文字等级和少量材料分层建立秩序；切换剧本时整套封面、主题和能力原子更换，不出现混合状态。

**Key Characteristics:**

- 一个当前剧本占据首视口，而不是均权卡片集合。
- 平面色块、节目单式排版和明确分隔，不用玻璃与装饰性渐变。
- 控件完整表达 hover、按压、等待、禁用、错误和键盘焦点。
- 宿主语义一致，剧本视觉彼此独立。

## Colors

宿主使用低彩度后台中性色与纸张前景；铜色只表达当前选择，青绿色只表达焦点与确认，危险色只表达需要处理的问题。激活剧本后同名 `--cg-*` 语义角色由剧本主题覆盖。

**The Stage Ownership Rule.** 宿主色不能在剧本舞台中形成第二个品牌层；大面积世界色属于当前剧本。

## Typography

宿主使用覆盖中文的工作型无衬线体。标题靠尺度、字重与紧凑字面建立节目感，不用装饰衬线或全大写 mono 假装“游戏化”；剧本可通过本地字体重写叙事与数据角色。

- **Headline:** 720，`clamp(2.25rem, 5vw, 4.75rem)`，行高 1.02，用于当前剧本标题。
- **Title:** 650，`clamp(1.35rem, 2.5vw, 2rem)`，行高 1.15，用于页面与面板标题。
- **Body:** 400，1rem，行高 1.65，正文控制在 65–75ch。
- **Label:** 620，0.875rem，行高 1.35，用于动作与状态；不以极端字距或全大写制造层级。

## Layout

桌面启动器采用主节目区与操作列的不对称布局：封面/剧本信息拥有约三分之二宽度，开始与继续动作在剩余列形成单一阅读顺序。移动端把主视觉收为上方 38–44dvh 的场景窗口，操作区自然滚动；短横屏降低封面高度并保留所有操作。剧本库是可搜索的纵向档案，不用同尺寸卡片铺满页面。

间距使用 6px 基数，紧密控件内部为 12–18px，区块之间至少 24–36px。所有固定区域使用安全区 inset，文字缩放到 200% 时不得依赖固定高度保住构图。

## Elevation & Depth

默认通过色块与遮挡关系分层，不在每个容器上叠边框和阴影。只有需要保护焦点的 Dialog 使用向下偏移的柔和环境阴影；hover 以表面、字重或轻微位置变化表达，不使用彩色光晕。

**The Flat-By-Default Rule.** 静止界面保持平面，深度只在焦点和被抬起的临时层出现。

## Shapes

大面积舞台接近直角或使用极小裁切；交互控件使用 12px 圆角，独立表面最多 14px。药丸只用于短状态和筛选，不用于普通按钮、导航或长文本。图标为统一线宽的 `currentColor` SVG。

## Motion

宿主动效采用 Corporate / rigid 语言：不弹跳、不漂浮、不做环境循环。全局只用 `--cg-motion-quick`（90ms）、`--cg-motion-standard`（160ms）、`--cg-motion-deliberate`（360ms）三档时序；hover 使用 quick，按压使用 standard，Dialog 以 deliberate + ease-out 进入并以 220ms + ease-in 退出。等待、成功与错误必须同时有文字或结构标记，不能只靠颜色或透明度；系统或玩家选择减少动效时删除空间位移与循环，但保留瞬时按压、等待文案和结果反馈。

## Components

### Buttons

- **Primary:** 48px 最小高度，纸色实底与深色文字，动作名称具体；hover 提高前景对比并轻微抬升，active 下压 1px。
- **Secondary:** 深表面或文本动作，不能与主操作同权。
- **Focus:** 3px 可见焦点轮廓并保留 2px 间距；不得只改变背景色。
- **Disabled / Loading:** 保留动作文字语义，说明不可用原因或当前步骤。

### Cards / Containers

剧本库条目以封面、标题、来源与状态组成不等高档案行；详情在同页展开。避免嵌套卡片。当前剧本通过比例与位置领先，而不是依赖更亮边框。

### Inputs / Fields

输入采用实色表面、清晰标签与常驻边界。错误信息紧邻字段并同时给出问题与恢复方式；placeholder 不承担标签职责。

### Dialog

只用于新游戏配置、替换确认等必须保护焦点的任务。打开后背景 inert，Esc 关闭最上层，关闭后焦点回到触发器。长任务如剧本浏览和设置使用独立页面。

### Navigation

全局入口保持“游戏、剧本、设置”三类语义。主启动器只呈现玩家动作，不暴露导入、构建或调试术语。

## Do's and Don'ts

### Do:

- **Do** 让当前剧本的真实封面和世界状态成为首屏主视觉。
- **Do** 使用动作动词与结果反馈，让按钮在 hover、active、busy、success 和 error 都有可感知状态。
- **Do** 在 390×844、短横屏与 200% 文字下保持同一任务顺序。
- **Do** 让剧本 UI 只通过语义 `--cg-*` token 和宿主 capability 工作。

### Don't:

- **Don't** 用卡片墙、玻璃、霓虹、装饰性渐变或泛光制造“游戏感”。
- **Don't** 把设置、导入和开始游戏合并成一个含糊动作。
- **Don't** 用动画掩盖状态竞态；主题、封面与 UI bundle 必须来自同一激活版本。
- **Don't** 让宿主的形状、字体或颜色覆盖剧本自己的视觉世界。
