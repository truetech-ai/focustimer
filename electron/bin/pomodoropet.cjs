#!/usr/bin/env node
const { execFileSync } = require('child_process')
const path = require('path')
const electron = require('electron')

execFileSync(String(electron), [path.join(__dirname, '..')], { stdio: 'inherit' })
