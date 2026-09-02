// Gitee 配置（纯前端 + Gitee 仓库 JSON 存储，替代后端）
// 部署前请在此填入你的 Gitee 信息。数据存在仓库的 data.json 里，前端通过 Gitee API 读写。
//
// ⚠️ 安全说明（务必读）：
//   pat 会出现在公开的网页源码中（因为纯前端必须带它才能写仓库）。
//   请遵循「最小风险」原则：
//   1) 用一个【专用】Gitee 私人令牌，而不是你账号的主令牌；
//   2) 创建令牌时只勾「projects」权限（仓库读写），不要勾 user/ admin 等；
//   3) 该令牌只能读写你这个仓库的 data.json，不能删库、不能动其他服务；
//   4) 若泄露，去 Gitee「设置 → 私人令牌」立即撤销重发即可。
//   内部小工具这样够用；若你要更高安全等级，可改走 Gitee OAuth 登录（我可再加）。
window.GITEE_CONFIG = {
  owner: 'yxin1',                  // 你的 Gitee 登录名（显示名 yang，human_name 即 yang/vehicle-reservation）
  repo: 'vehicle-reservation',     // 存放本项目的 Gitee 仓库名
  branch: 'master',                // 默认分支（Gitee 新建仓库多为 master）
  path: 'data.json',               // 数据文件名（放在仓库根目录）
  pat: 'fced004445bf667172620917b8604880'  // 仅勾 projects 权限的专用私人令牌
  ,
  // 云端同步 Worker（Cloudflare Worker）地址：进页面时由它去拉腾讯文档并写回 Gitee。
  // 部署 Worker 后填入，例如 'https://vr-sync.xxxxxx.workers.dev/sync'；留空则不做进页面同步。
  syncWorkerUrl: 'https://vr-tdoc-sync.2456040366.workers.dev/sync'
};
