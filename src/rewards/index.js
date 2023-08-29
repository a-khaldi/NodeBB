"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const util = __importStar(require("util"));
const db = __importStar(require("../database"));
const plugins = __importStar(require("../plugins"));
const promisify_1 = __importDefault(require("../promisify"));
// interface RewardWithScore extends Reward {
//     score: number;
// }
async function isConditionActive(condition) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const result = await db.isSetMember('conditions:active', condition);
    if (typeof result === 'boolean') {
        return result;
    }
    return false;
}
async function getIDsByCondition(condition) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const result = await db.getSetMembers(`condition:${condition}:rewards`);
    if (Array.isArray(result) && result.every(item => typeof item === 'string')) {
        return result;
    }
    return [];
}
async function getRewardDataByIDs(ids) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const dataOfReward = await db.getObjects(ids.map(id => `rewards:id:${id}`));
    return dataOfReward.filter(reward => reward !== undefined);
}
async function filterCompletedRewards(uid, rewards) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const data = await db.getSortedSetRangeByScoreWithScores(`uid:${uid}:rewards`, 0, -1, 1, '+inf');
    const userRewards = {};
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    data.forEach((obj) => {
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
        userRewards[obj.value] = parseInt(obj.score, 10);
    });
    return rewards.filter((reward) => {
        if (!reward) {
            return false;
        }
        const claimable = parseInt(reward.claimable.toString(), 10);
        return (claimable === 0 ||
            (!userRewards[reward.id] || userRewards[reward.id] < claimable));
    });
}
async function checkCondition(reward, method) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    if (!(method.constructor && method.constructor.name !== 'AsyncFunction')) {
        method = util.promisify(method);
    }
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const value = await method();
    await plugins.hooks.fire(`filter:rewards.checkConditional:${reward.conditional}`, { left: value, right: reward.value });
}
async function getRewardsByRewardData(rewards) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    return await db.getObjects(rewards.map(reward => `rewards:id:${reward.id}:rewards`));
}
async function giveRewards(uid, rewards) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const rewardData = await getRewardsByRewardData(rewards);
    for (let i = 0; i < rewards.length; i++) {
        /* eslint-disable no-await-in-loop */
        await plugins.hooks.fire(`action:rewards.award:${rewards[i].rid}`, { uid: uid, reward: rewardData[i] });
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
        await db.sortedSetIncrBy(`uid:${uid}:rewards`, 1, rewards[i].id.toString());
    }
}
const rewards = {};
/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
rewards.checkConditionAndRewardUser = async function (params) {
    const { uid, condition, method } = params;
    const isActive = await isConditionActive(condition);
    if (!isActive) {
        return;
    }
    const ids = await getIDsByCondition(condition);
    let rewardData = await getRewardDataByIDs(ids);
    rewardData = await filterCompletedRewards(uid, rewardData);
    rewardData = rewardData.filter(Boolean);
    if (!rewardData || !rewardData.length) {
        return;
    }
    const eligible = await Promise.all(rewardData.map(async (reward) => await checkCondition(reward, method)));
    const eligibleRewards = rewardData.filter((reward, index) => eligible[index]);
    await giveRewards(uid, eligibleRewards);
};
/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
(0, promisify_1.default)(rewards);
