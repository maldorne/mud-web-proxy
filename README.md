# mud-web-proxy

### What is this?

[node.js](https://nodejs.org/en/) microserver which provides a secure websocket (`wss://` protocol) to telnet (`telnet://`) proxy for [MUD](https://en.wikipedia.org/wiki/MUD) / MUSH / MOO game servers, supporting all major data interchange and interactive text protocols. You can use the [`mud-web-client`](https://github.com/houseofmaldorne/mud-web-client) project to achieve that.

### History

This project is a fork of [MUDPortal-Web-App](https://github.com/plamzi/MUDPortal-Web-App), made by [@plamzi](https://github.com/plamzi), creator of [mudportal.com](http://www.mudportal.com/). The original project had the code of both the client and proxy-server apps, and was outdated and did not support secure connections (`wss://` instead of `ws://`), so I decided to fork it, separate in different projects and update them. But kudos to [@plamzi](https://github.com/plamzi), who is the original author.

### Motivation

In modern browsers, web-pages served through `https://` are not allowed to open connections to non-secure locations, so an `https://`-served web could not include a web client which opens a connection using `ws://`. Modifications were needed to allow secure connections.

## Features

* MCCP compression support (zlib)

* MXP protocol support built into the client

* MSDP protocol support

* GMCP / ATCP protocol support (JSON) with sample uses in multiple existing plugins

* 256-color support, including background colors

* Unicode font support and UTF-8 negotiation

## Installation

``` bash
git clone https://github.com/houseofmaldorne/mud-web-proxy
npm install
sudo node wsproxy.js
```

## Configuration

To Do

