# 剧本 UI 激活竞态导致首屏突变

## Executive summary

启动器先读取模块级 slot Map，再在 effect 中异步加载剧本 UI；注册完成不会通知 React，且主题从数组第一项而不是明确默认项选择。玩家因此先看到 fallback，切换剧本时还可能得到当前标题、上一套背景或错误主题，直到一次无关点击触发重渲染。测试只验证 bundle 能构建和函数能返回，没有经过真实浏览器观察“选择剧本到完整呈现”的原子性。持久教训是：可加载不等于已激活，动态表现必须拥有版本、订阅、竞态取消和真实入口回归。

## Summary

用户在启动器点击《灰烬镇》后看到画面突然变成另一套深色背景。首屏与交互后的画面并非有意过渡，而是主题与 UI bundle 分别异步生效、slot 注册不可观察造成的混合状态。

## Timeline

1. 启动器渲染时从全局 Map 查询剧本背景，未命中后显示框架 fallback。
2. effect 请求并执行 UI bundle，bundle 直接修改 Map，但没有 state、订阅或原子 activation。
3. React 不会因为 Map 修改重渲染；后续点击改变任意组件状态时，启动器才重新读取并显示背景。
4. 剧本切换请求没有 generation 保护，较慢的旧请求可以晚于新请求注册。
5. 主题使用数组首项，加载器的插入顺序被误当成产品默认项。
6. 构建、类型和 Node 测试均通过，因为没有浏览器级激活时序断言。

## Root cause

直接原因是把异步资源注册实现为不可观察的模块级副作用，并让主题、bundle、slot 与 React render 分别提交。系统性原因是公开扩展契约没有对应的真实宿主状态机，测试也只覆盖静态构建而未验证玩家从选择到首屏的完整路径。

## Guardrails

- [0022](../decisions/0022-ui-host-and-script-extension-v3.md) 定义不可变临时 registry、版本校验、订阅和主题/bundle 原子激活。
- [0024](../decisions/0024-frontend-workbench-and-ci.md) 要求真实浏览器覆盖首次加载、快速 A→B 切换、bundle 失败与同 ID 替换。
- `ScriptPresentation` 使用明确 `defaultThemeId`，不得从集合顺序推断默认主题。
- E2E 断言玩家点击前后剧本 id、标题、主题、背景和可用动作来自同一激活版本。
