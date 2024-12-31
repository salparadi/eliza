import { Plugin, elizaLogger } from '@elizaos/core'
import { tipAction } from './actions/tip'

export const warpcastTipsPlugin: Plugin = {
  name: 'warpcast-tips',
  description: 'Plugin for tipping Warpcast users based on interaction quality',
  actions: [tipAction],
  evaluators: [],
  providers: []
}

export default warpcastTipsPlugin
