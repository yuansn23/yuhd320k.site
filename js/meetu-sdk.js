// ============================================================
//  MeetU SDK v1.0 - 第三方调用核心库
//  功能：动态加载 Facebook Pixel + APK 下载跳转
//  兼容：支持自定义全局函数名，无痛集成
// ============================================================

(function(global) {
    'use strict';

    // ---------- 1. 基础配置 ----------
    var API_BASE = 'https://url.yuhd320k.site';   // 你的后台地址
    var _site = global.location.origin + global.location.pathname;
    var _apkUrl = '';

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

    // 拉取像素 ID 并初始化
    fetch(API_BASE + '/api/pixels?site=' + encodeURIComponent(_site))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            console.log('[MeetU SDK] Pixel API 返回:', JSON.stringify(d));
            var ids = d.ids || [];
            if (!ids.length) {
                console.warn('[MeetU SDK] 像素ID为空, site=' + _site);
                return;
            }
            console.log('[MeetU SDK] 已加载像素:', ids);
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
        })
        .catch(function() {
            console.warn('[MeetU SDK] 像素获取失败');
        });

    // ---------- 3. 核心下载方法 (供外部调用) ----------
    async function coreDownload(source) {
        // 跟踪转化事件
        fbq('track', 'AddToCart');
        fbq('track', 'Contact');
        fbq('track', 'Lead');
        fbq('track', 'CompleteRegistration');
        fbq('track', 'Lead');
         fbq('trackCustom', '下载');
        fbq('track', 'Purchase');

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
