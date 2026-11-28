const base = require("/Users/liubu/hx/4.uprxiao/SmartDD/electron-builder.config.cjs");
module.exports = {...base, appId:'com.smartdd.desktop.qa.m16-notifications', mac:{...base.mac, extendInfo:{...base.mac.extendInfo, CFBundleDisplayName:'WillYou QA M16 Notifications'}}};
