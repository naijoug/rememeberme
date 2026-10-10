// Recognize actual syllables before treating bracketed numbers as tones.
// This keeps ordinary references, versions and identifiers intact.
const SYLLABLES = new Set(`
a ai an ang ao
ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo
da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo
e ei en eng er ê
fa fan fang fei fen feng fo fou fu
ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe
ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nü nüe
o ou
pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo
sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo
ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
wa wai wan wang wei wen weng wo wu
xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo
m n ng hm hng
`.trim().split(/\s+/));
const SYLLABLE = /[a-züê:]+[0-5]/giu;
const PINYIN = /^[a-züê:]+[0-5](?:[\s'’\-]*[a-züê:]+[0-5])*$/iu;
const TONES = ['\u0304', '\u0301', '\u030c', '\u0300'];

function normalizeSyllable(value: string): string {
  return value.slice(0, -1).replace(/u:/gi, match => match[0] === 'U' ? 'Ü' : 'ü').replace(/v/gi, match => match === 'V' ? 'Ü' : 'ü');
}
function validSyllable(value: string): boolean {
  const letters = normalizeSyllable(value);
  // A4/B2 and similar uppercase references are not pinyin annotations.
  return letters !== letters.toUpperCase() && SYLLABLES.has(letters.toLowerCase());
}
function markTone(value: string): string {
  const letters = normalizeSyllable(value);
  const tone = Number(value.at(-1));
  if (tone === 0 || tone === 5) return letters;
  const lower = letters.toLowerCase();
  // a, then e, then the o of ou; otherwise the final vowel (liu / gui).
  let index = lower.indexOf('a');
  if (index < 0) index = lower.indexOf('e');
  if (index < 0) index = lower.indexOf('ou');
  if (index < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouüê'.includes(lower[i]!)) { index = i; break; }
    }
  }
  // Syllabic nasals: mark m in hm, n in ng / hng.
  if (index < 0) index = lower.includes('n') ? lower.indexOf('n') : lower.indexOf('m');
  return (letters.slice(0, index + 1) + TONES[tone - 1] + letters.slice(index + 1)).normalize('NFC');
}

/** Format provider/saved pinyin for display only; never rewrite translation data. */
export function formatChineseTranslation(text: string): string {
  return text.replace(/\[([^\[\]]+)\]/g, (original: string, content: string, offset: number) => {
    if (!/\p{Script=Han}/u.test(text.slice(0, offset)) || !PINYIN.test(content.trim())) return original;
    const syllables = content.match(SYLLABLE);
    if (!syllables?.every(validSyllable)) return original;
    return '[' + content.replace(SYLLABLE, markTone) + ']';
  });
}
