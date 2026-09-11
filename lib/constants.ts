export const PARTS_OF_SPEECH = [
  { value: "n.", label: "n. 名词" },
  { value: "v.", label: "v. 动词" },
  { value: "adj.", label: "adj. 形容词" },
  { value: "adv.", label: "adv. 副词" },
  { value: "prep.", label: "prep. 介词" },
  { value: "conj.", label: "conj. 连词" },
  { value: "pron.", label: "pron. 代词" },
  { value: "interj.", label: "interj. 感叹词" },
  { value: "num.", label: "num. 数词" },
  { value: "art.", label: "art. 冠词" },
  { value: "phr.", label: "phr. 短语" },
] as const;

export const ENCOURAGEMENTS = [
  "加油！今天也要元气满满地背单词哦 (ง •̀_•́)ง",
  "每天进步一点点，未来会感谢现在的自己 ✧",
  "坚持就是胜利，你已经很棒啦 ヾ(^▽^*)",
  "不积跬步，无以至千里 (๑•̀ㅂ•́)و✧",
  "今天的努力是明天的礼物，继续加油 ヽ(•‿•)ノ",
  "学习如逆水行舟，不进则退，冲鸭！",
  "知识就是力量，再来一个单词吧 ✿",
  "一分耕耘，一分收获，相信自己！",
];

export function randomEncouragement(): string {
  return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
}
