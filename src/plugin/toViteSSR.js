const { createServer, build } = require('vite')
const requireFromString = require('require-from-string')
const logger = require('../utils/logger')

/**
 * @typedef {import('./reactPlugin/componentAttrStore').ComponentAttrs['styleToFilePathMap']} StyleToFilePathMap
 * @returns {{
 *   getCSS: () => StyleToFilePathMap;
 *   plugin: import('vite').PluginOption;
 * }}
 */
function gimmeCSSPlugin() {
  /**
   * @type {StyleToFilePathMap}
   */
  const styleToFilePathMap = {}

  return {
    getCSS() {
      return styleToFilePathMap
    },
    plugin: {
      name: 'gimme-css-plugin',
      transform(code, id) {
        if (/\.(css|scss|sass|less|stylus)$/.test(id)) {
          styleToFilePathMap[id] = code
          return { code: '' }
        }
        return null
      },
    },
  }
}

/**
 * @typedef ViteSSRParams
 * @property {'dev' | 'prod'} environment - whether we want a dev server or a production build
 * @property {import('./index').PluginOptions['dir']} dir
 * @param {ViteSSRParams}
 *
 * @typedef {{
 *  default: () => any;
 *  getProps: (eleventyData: any) => any;
 *  frontMatter: Record<string, any>;
 *  __stylesGenerated: Record<string, string>;
 * }} FormattedModule - expected keys from a given component module
 *
 * @typedef ViteSSR - available fns for module conversion
 * @property {(filePath: string) => Promise<FormattedModule>} toComponentCommonJSModule - fn to grab a Node-friendly module output from a given file path
 *
 * @returns {ViteSSR} viteSSR
 */
module.exports = async function toViteSSR({ environment, dir }) {
  const generatedStyles = gimmeCSSPlugin()

  if (environment === 'dev') {
    const server = await createServer({
      root: dir.output,
      plugins: [generatedStyles.plugin],
      server: {
        middlewareMode: 'ssr',
      },
      clearScreen: false,
    })
    return {
      async toComponentCommonJSModule(filePath) {
        const viteOutput = await server.ssrLoadModule(filePath)
        return {
          default: () => null,
          getProps: () => ({}),
          frontMatter: {},
          __stylesGenerated: generatedStyles.getCSS(),
          ...viteOutput,
        }
      },
    }
  } else {
    /**
     * @type {Record<string, FormattedModule>}
     */
    const probablyInefficientCache = {}
    return {
      async toComponentCommonJSModule(filePath) {
        if (probablyInefficientCache[filePath]) return probablyInefficientCache[filePath]

        const { output } = await build({
          root: dir.output,
          plugins: [generatedStyles.plugin],
          build: {
            ssr: true,
            write: false,
            rollupOptions: {
              input: filePath,
            },
          },
        })
        /**
         * @type {FormattedModule}
         */
        const mod = {
          default: () => null,
          getProps: () => ({}),
          frontMatter: {},
          __stylesGenerated: generatedStyles.getCSS(),
        }
        if (!output?.length) {
          logger.log({
            type: 'error',
            message: `Module ${filePath} didn't have any output. Is this file blank?`,
          })
          return mod
        }
        probablyInefficientCache[filePath] = {
          ...mod,
          // converts our stringified JS to a CommonJS module in memory
          // saves reading / writing to disk!
          // TODO: check performance impact
          ...requireFromString(output[0].code),
        }
        return probablyInefficientCache[filePath]
      },
    }
  }
}
