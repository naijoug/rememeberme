import { describe, expect, it } from 'vitest';
import { formatChineseTranslation } from './pinyin-format';

describe('numbered pinyin display', () => {
  it.each([
    ['哄騙 哄骗 [hong3 pian4]', '哄騙 哄骗 [hǒng piàn]'],
    ['妈妈 [ma1 ma2 ma3 ma4 ma5 ma0]', '妈妈 [mā má mǎ mà ma ma]'],
    ['汉语 [han4 yu3 pin1 yin1]', '汉语 [hàn yǔ pīn yīn]'],
    ['规则 [liu2 gui4 shui3 dou1 you3]', '规则 [liú guì shuǐ dōu yǒu]'],
    ['女绿 [nv3 lu:4 nü3 lüe4]', '女绿 [nǚ lǜ nǚ lüè]'],
    ['你好 [Ni3 Hao3]', '你好 [Nǐ Hǎo]'],
    ["西安 [xi1'an1]，汉语 [han4-yu3]", "西安 [xī'ān]，汉语 [hàn-yǔ]"],
    ['哄骗 [hong3pian4]', '哄骗 [hǒngpiàn]'],
    ['哄骗 [  hong3  pian4  ]', '哄骗 [  hǒng  piàn  ]'],
    ['嗯 [ng2]', '嗯 [ńg]'],
  ])('formats %s without losing wording or spacing', (input, expected) => {
    expect(formatChineseTranslation(input)).toBe(expected);
    expect(formatChineseTranslation(expected)).toBe(expected);
  });

  it.each([
    '说明 [version3] 第4版 2026年', '纸张 [A4] 型号 [B2]', '说明 [hong3 version2]',
    '说明 [hong6 pian9]', '说明 [1 2 3]', '说明 [test3]', 'English [ma3]',
    '哄骗 hong3 pian4', '哄骗 [hǒng piàn]', '哄骗 [hong3 pian4',
  ])('preserves non-pinyin numbers and incomplete/unknown annotations: %s', input => {
    expect(formatChineseTranslation(input)).toBe(input);
  });
});
