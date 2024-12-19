import { Plugin, elizaLogger } from '@ai16z/eliza'
import { tipAction } from './actions/tip'

export const warpcastTipsPlugin: Plugin = {
  name: 'warpcast-tips',
  description: 'Plugin for tipping Warpcast users based on interaction quality',
  actions: [tipAction],
  evaluators: [],
  providers: []
}

export default warpcastTipsPlugin
