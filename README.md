# 车辆预约系统（Vehicle Reservation）

一个**零依赖**、可**公网部署**、访问**稳定快速**的车辆预约网站工具。

## 功能
- 📅 **日历视图**：月历直观展示每日车辆预约情况，限行尾号以徽标标注。
- 🚫 **尾号限行规则**：可配置每周各工作日限行尾号（默认北京规则：周一1/6、周二2/7…），新增预约时自动校验并拦截限行车辆（管理员可强制）。
- 🚗 **车辆管理**：车辆增删改查、状态（可用/维修中）、备注。
- 📊 **使用统计**：车辆总数、可用/维修数、未来/历史预约数、各车使用排行、近期预约。
- 🔐 **管理员鉴权**：访客只读；管理员可编辑（默认密码 `admin123`，请尽快修改）。

## 技术特点
- 后端仅用 Node 内置模块（`http`/`fs`/`path`/`crypto`），**无需 `npm install`、无第三方依赖**。
- 数据以 JSON 文件（`./data/db.json`）原子写入持久化，零运维。
- 前端为原生 HTML/CSS/JS，体积小、加载快。

## 本地运行
```bash
node server.js          # 默认 http://localhost:3000
# 或自定义端口
PORT=8080 node server.js
```
要求 Node >= 16。首次启动自动在 `data/db.json` 生成示例数据。

## 公网部署（任选其一）

### 方式一：Render（最省事，免费公网 HTTPS）
1. 把项目推到 GitHub。
2. 在 Render 用 `render.yaml` 作为 BluePrint 创建 Web Service（免费版即获得 `https://xxx.onrender.com`）。
> 注：Render 免费实例空闲后会休眠，首次访问稍慢；对稳定性要求高可选付费或方式二/三。

### 方式二：Docker（VPS / 任意容器平台）
```bash
docker build -t vehicle-reservation .
docker run -d --name vr -p 3000:3000 -v $(pwd)/data:/app/data vehicle-reservation
```

### 方式三：直接 node 运行 + nginx 反代
```bash
nohup node server.js &
```
配合 `nginx.conf.example` 反代，并用 Cloudflare / Let's Encrypt 提供 HTTPS，可显著提升国内访问速度与稳定性。

## 接口一览
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/vehicles | 车辆列表 |
| POST/PUT/DELETE | /api/vehicles[/:id] | 车辆增改删（需管理员） |
| GET | /api/reservations?from=&to=&vehicleId= | 预约列表（可筛选） |
| POST/PUT/DELETE | /api/reservations[/:id] | 预约增改删（需管理员，自动校验限行/冲突） |
| GET/PUT | /api/restriction | 限行规则读取/配置（写需管理员） |
| GET | /api/stats | 统计 |
| POST | /api/login | 管理员登录校验 |

管理员操作需在请求头携带 `x-admin-password: <密码>`。
