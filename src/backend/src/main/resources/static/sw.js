/*
 * PWA Service Worker
 *
 * 缓存策略（刻意保持简单，三类请求泾渭分明）：
 *   1. 同源 GET 静态资源（js/css/图标/字体）—— stale-while-revalidate：
 *      秒开用缓存，后台悄悄更新，下次打开就是新的
 *   2. 同源导航（页面跳转）—— network-first，失败回退缓存的 index.html：
 *      深链（/info、/todos）离线也能开，由 react-router 接管路由
 *   3. /api/** 一律走网络——课表/待办/通知必须新鲜；离线时请求失败，
 *      前端各页面已有错误提示，不在 SW 层伪造数据
 *
 * 版本号(CACHE)升级时旧缓存自动清除；改这里务必同步 bump，否则用户
 * 会拿到旧壳配新 html 的撕裂状态。
 */
// 注意：这个键名带老品牌名，但**故意不改**——它是缓存标识，不是展示文案。
// 清理逻辑是「删掉所有不等于当前 CACHE 的缓存」，一改名就等于换了一个新空间，
// 已装用户机器上那份旧缓存再也没人删得掉，会一直占着容量。
var CACHE = 'tangent-timetable-v1'
var SHELL = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.addAll(SHELL)
      })
      .then(function () {
        return self.skipWaiting()
      }),
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== CACHE) return caches.delete(key)
          }),
        )
      })
      .then(function () {
        return self.clients.claim()
      }),
  )
})

function isApi(url) {
  return url.pathname.indexOf('/api/') === 0
}

self.addEventListener('fetch', function (event) {
  var req = event.request
  if (req.method !== 'GET') return

  var url = new URL(req.url)
  // 只接管本站请求；第三方（如图片 CDN、字体）原样放行
  if (url.origin !== self.location.origin) return

  // API：数据新鲜优先，SW 不插手
  if (isApi(url)) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone()
          caches.open(CACHE).then(function (cache) {
            cache.put('/index.html', copy)
          })
          return res
        })
        .catch(function () {
          return caches.match('/index.html').then(function (hit) {
            return hit || caches.match('/')
          })
        }),
    )
    return
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone()
            caches.open(CACHE).then(function (cache) {
              cache.put(req, copy)
            })
          }
          return res
        })
        .catch(function () {
          return hit
        })
      return hit || network
    }),
  )
})
