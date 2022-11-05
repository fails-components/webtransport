/* eslint-env mocha */

import { expect } from 'chai'
import * as Utils from '../lib/utils.js'
import { arch, platform } from 'node:process'

/**
 * @template T
 * @typedef {import('../lib/types').Deferred<T>} Deferred<T>
 */

describe('utils', function () {
  describe('defer', () => {
    it('should defer a value', async () => {
      /** @type {Deferred<boolean>} */
      const deferred = Utils.defer()
      deferred.resolve(true)

      expect(await deferred.promise).to.be.true
    })

    it('should reject', async () => {
      const err = new Error('Urk!')
      const deferred = Utils.defer()
      deferred.reject(err)

      expect(await deferred.promise.catch(e => e)).to.equal(err)
    })
  })

  describe('findWTBinaryPaths', () => {
    it('should include release paths', () => {
      const paths = Utils.findWTBinaryPaths()

      expect(paths.find(path => path.includes('build/Release/webtransport.node')))
        .to.be.ok
      expect(paths.find(path => path.includes(`build_${platform}_${arch}/Release/webtransport.node`)))
        .to.be.ok
      expect(paths.find(path => path.includes(`build_${platform}_${arch}/Debug/webtransport.node`)))
        .to.not.be.ok
    })

    it('should include debug paths when `includeDebug` is specified', () => {
      const paths = Utils.findWTBinaryPaths(true)

      expect(paths.find(path => path.includes('build/Release/webtransport.node')))
        .to.be.ok
      expect(paths.find(path => path.includes(`build_${platform}_${arch}/Release/webtransport.node`)))
        .to.be.ok
      expect(paths.find(path => path.includes(`build_${platform}_${arch}/Debug/webtransport.node`)))
        .to.be.ok
    })
  })
})
