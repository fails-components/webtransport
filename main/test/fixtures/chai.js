import chai from 'chai'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(dirtyChai)
chai.use(chaiAsPromised)

export const expect = chai.expect
