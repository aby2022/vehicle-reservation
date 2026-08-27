// ============ 高德地图 Web端(JS API) 配置 ============
// 申请地址：https://console.amap.com/dev/key/app
//   1) 创建应用后，添加 Key，类型选「Web端(JS API)」
//   2) 该 Key 同时会给出一个「安全密钥」(securityJsCode)，一并填入下方
// 注意：Key 和 安全密钥 都要填，缺一高德 v2.0 无法加载。
// 坐标说明：高德使用 GCJ-02 坐标系，本系统存储的坐标即为 GCJ-02，
//   与系统其它功能（如 KMZ/WGS84 转换）分开处理，便于后续互转。
window.AMAP_KEY = '734f87dcd219650f2158b5d8d815d9c2';        // ← 替换为你的高德 Key
window.AMAP_SECURITY = 'b33e40d2b1da401c973c67eddd6fa923'; // ← 替换为你的高德安全密钥
window.AMAP_DEFAULT_CENTER = [116.397428, 39.90923]; // 默认中心点（北京天安门，GCJ-02）
