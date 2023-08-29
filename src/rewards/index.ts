// import * as util from 'util';
import * as db from '../database';
import * as plugins from '../plugins';
import promisifyModule from '../promisify';

interface Reward {
    id: number;
    conditional: string;
    value: string | number | boolean;
    claimable: number;
    rid: string;
}
// interface RewardWithScore extends Reward {
//     score: number;
// }

async function isConditionActive(condition: string): Promise<boolean> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const result: unknown = await db.isSetMember('conditions:active', condition);
    if (typeof result === 'boolean') {
        return result;
    }
    return false;
}

async function getIDsByCondition(condition: string): Promise<string[]> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const result: unknown = await db.getSetMembers(`condition:${condition}:rewards`);

    if (Array.isArray(result) && result.every(item => typeof item === 'string')) {
        return result as string[];
    }
    return [];
}

async function getRewardDataByIDs(ids: string[]): Promise<Reward[]> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const dataOfReward: Reward[] = await db.getObjects(ids.map(id => `rewards:id:${id}`)) as Reward[];
    return dataOfReward.filter(reward => reward !== undefined);
}

async function filterCompletedRewards(
    uid: number,
    rewards: Reward[]
): Promise<Reward[]> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const data = await db.getSortedSetRangeByScoreWithScores(
        `uid:${uid}:rewards`,
        0,
        -1,
        1,
        '+inf'
    ) as { value: string; score: string}[];
    const userRewards: { [key: string]: number } = {};
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
        return (
            claimable === 0 ||
            (!userRewards[reward.id] || userRewards[reward.id] < claimable)
        );
    });
}

function isAsync(func: MethodType): boolean {
    return func.constructor && func.constructor.name === 'AsyncFunction';
}

function convertToPromise(method: MethodType): MethodType {
    return async () => {
        const result = method();
        if (result instanceof Promise) {
            return result;
        }
        return Promise.resolve(result as boolean);
    };
}

type MethodType = () => Promise<boolean>;

async function checkCondition(reward: Reward, method: MethodType): Promise<void> {
    const mPromise = isAsync(method) ? method : convertToPromise(method);

    const value = await mPromise();
    await plugins.hooks.fire<boolean>(`filter:rewards.checkConditional:${reward.conditional}`, { left: value, right: reward.value });
}

async function getRewardsByRewardData(rewards: Reward[]): Promise<Reward[]> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    return await db.getObjects(rewards.map(reward => `rewards:id:${reward.id}:rewards`)) as Reward[];
}

async function giveRewards(uid: number, rewards: Reward[]): Promise<void> {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    const rewardData = await getRewardsByRewardData(rewards);
    for (let i = 0; i < rewards.length; i++) {
        /* eslint-disable no-await-in-loop */
        await plugins.hooks.fire(`action:rewards.award:${rewards[i].rid}`, { uid: uid, reward: rewardData[i] });
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
        await db.sortedSetIncrBy(`uid:${uid}:rewards`, 1, rewards[i].id.toString());
    }
}

const rewards: any = {};
/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
rewards.checkConditionAndRewardUser = async function (params: {
    uid: number;
    condition: string;
    method: () => Promise<boolean>;
}): Promise<void> {
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
    const eligible = await Promise.all(
        rewardData.map(async reward => await checkCondition(reward, method))
    );
    const eligibleRewards = rewardData.filter((reward, index) => eligible[index]);
    await giveRewards(uid, eligibleRewards);
};
/* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
promisifyModule(rewards);
