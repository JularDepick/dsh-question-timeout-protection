# Tag&Release 规范

## 版本号

遵守 `v<主版本号>.<次版本号>.<修订版本号>` 格式, 例如 `v0.1.0`.

> README 的版本徽章显示文字中, 版本号不带 `v` 字母前缀

## Tag

遵守 `<版本号>` 格式.

## Release

遵守 `<版本号>-dsh-<本版本实测验证过的最高 dsh 版本号>` 格式, 例如 `v0.1.0-dsh-0.2.2-rc.1`(仅示意格式, 实际取名以本版本实测结果为准).

> `engines.dsh` 可以声明一个覆盖范围(当前为 `>=0.2.1-rc.1 <=0.2.2-rc.2`), 而 Release 名只能写一个版本号, 因此取该范围内实测验证过的最高版本. 范围内的其余版本由 `engines.dsh` 与 README 的兼容性小节说明; 新增受支持版本时优先扩大范围, 只有出现不兼容变更才迭代项目版本号并另发 Release.

## 发布前检查

1. `git status` 干净: 全部改动已提交, 以该提交为基线重建产物, 不允许用未提交的工作区直接产出发布物
2. 按本地维护的版本索引清单逐处核对版本号, 避免只改包清单而漏掉文档与翻译 meta
3. `pnpm run check:translation`: 三份翻译文件, 配置页字典与宿主识别文案基线一致
4. `pnpm run typecheck`: 类型检查无错
5. `pnpm run pack:release`: 构建并产出 tarball, 落到打包输出目录
6. 核对 tarball: 文件清单为构建产物三件, 两份 README, 三份 ini, `cordis.patch.yml`, `COPYRIGHT`, `LICENSE` 与 `package.json`; 包内 `engines.dsh`, peer 范围与构建产物里的新文案与工作区一致
7. 在不带兼容性豁免的 profile 上验证 `engines.dsh` 放行, 避免豁免记录掩盖范围声明错误
8. 在目标 dsh 版本上装入 profile 实测, 覆盖倒计时, 无限等待, 自动无限等待, 超时收尾与草稿注入, 并覆盖三种交还宿主的路径, 空草稿, 草稿过长与非中英界面降级
9. 实测通过后再打 Tag 与建 Release, 发行版名取实测验证过的最高 dsh 版本
10. 若本次同时发布到 npm: 先 `npm publish` 发布正式版本, 再用 `npm view <包名> dist-tags` 确认 latest 已指向该版本. 仓库曾有过同名占位版本, 这类情况下尤其要核对 latest, 否则按包名安装会拿到占位包, dsh 只打一条警告并跳过该插件, 功能完全不出现
