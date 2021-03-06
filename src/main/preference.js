import fs from 'fs'
import path from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import { isOsx } from './config'
import appWindow from './window'
import { getPath, hasSameKeys, log, ensureDir } from './utils'

class Preference {
  constructor () {
    const FILE_NAME = 'preference.md'
    const staticPath = path.join(__static, FILE_NAME)
    const userDataPath = path.join(getPath('userData'), FILE_NAME)

    this.cache = null
    this.staticPath = staticPath
    this.userDataPath = userDataPath

    this.init()
  }

  init () {
    const { userDataPath, staticPath } = this
    const defaultSettings = this.loadJson(staticPath)
    let userSetting = null

    // Try to load settings or write default settings if file doesn't exists.
    if (!fs.existsSync(userDataPath) || !this.loadJson(userDataPath)) {
      ensureDir(getPath('userData'))
      const content = fs.readFileSync(staticPath, 'utf-8')
      fs.writeFileSync(userDataPath, content, 'utf-8')

      userSetting = this.loadJson(userDataPath)
      this.validateSettings(userSetting)
    } else {
      userSetting = this.loadJson(userDataPath)
      this.validateSettings(userSetting)

      // Update outdated settings
      const requiresUpdate = !hasSameKeys(defaultSettings, userSetting)
      if (requiresUpdate) {
        // remove outdated settings
        for (const key in userSetting) {
          if (userSetting.hasOwnProperty(key) && !defaultSettings.hasOwnProperty(key)) {
            delete userSetting[key]
          }
        }
        // add new setting options
        for (const key in defaultSettings) {
          if (defaultSettings.hasOwnProperty(key) && !userSetting.hasOwnProperty(key)) {
            userSetting[key] = defaultSettings[key]
          }
        }
        this.writeJson(userSetting, false)
          .catch(log)
      }
    }

    if (!userSetting) {
      console.error('ERROR: Cannot load settings.')
      userSetting = defaultSettings
      this.validateSettings(userSetting)
    }

    this.cache = userSetting
  }

  getAll () {
    return this.cache
  }

  setItem (key, value) {
    const preUserSetting = this.getAll()
    const newUserSetting = this.cache = Object.assign({}, preUserSetting, { [key]: value })
    return this.writeJson(newUserSetting)
  }

  loadJson (filePath) {
    const JSON_REG = /```json(.+)```/g
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const userSetting = JSON_REG.exec(content.replace(/(?:\r\n|\n)/g, ''))[1]
      return JSON.parse(userSetting)
    } catch (err) {
      log(err)
      return null
    }
  }

  writeJson (json, async = true) {
    const { userDataPath } = this
    return new Promise((resolve, reject) => {
      const content = fs.readFileSync(userDataPath, 'utf-8')
      const tokens = content.split('```')
      const newContent = tokens[0] +
        '```json\n' +
        JSON.stringify(json, null, 2) +
        '\n```' +
        tokens[2]
      if (async) {
        fs.writeFile(userDataPath, newContent, 'utf-8', err => {
          if (err) reject(err)
          else resolve(json)
        })
      } else {
        fs.writeFileSync(userDataPath, newContent, 'utf-8')
        resolve(json)
      }
    })
  }

  /**
   * workaround for issue #265
   *   expects: settings != null
   * @param  {Object} settings preferences object
   */
  validateSettings (settings) {
    if (!settings) {
      log('Broken settings detected: invalid settings object.')
      return
    }

    let brokenSettings = false
    if (!settings.theme || (settings.theme && !/^(dark|light)$/.test(settings.theme))) {
      brokenSettings = true
      settings.theme = 'light'
    }
    if (!settings.bulletListMarker ||
      (settings.bulletListMarker && !/^(\+|-|\*)$/.test(settings.bulletListMarker))) {
      brokenSettings = true
      settings.bulletListMarker = '-'
    }
    if (!settings.titleBarStyle || !/^(native|csd|custom)$/.test(settings.titleBarStyle)) {
      settings.titleBarStyle = 'csd'
    }
    if (brokenSettings) {
      log('Broken settings detected; fallback to default value(s).')
    }

    // Currently no CSD is available on Linux and Windows (GH#690)
    const titleBarStyle = settings.titleBarStyle.toLowerCase()
    if (!isOsx && titleBarStyle === 'csd') {
      settings.titleBarStyle = 'custom'
    }
  }
}

const preference = new Preference()

ipcMain.on('AGANI::ask-for-user-preference', e => {
  const win = BrowserWindow.fromWebContents(e.sender)
  win.webContents.send('AGANI::user-preference', preference.getAll())
})

ipcMain.on('AGANI::set-user-preference', (e, pre) => {
  Object.keys(pre).map(key => {
    preference.setItem(key, pre[key])
      .then(() => {
        for (const { win } of appWindow.windows.values()) {
          win.webContents.send('AGANI::user-preference', { [key]: pre[key] })
        }
      })
      .catch(log)
  })
})

export default preference
