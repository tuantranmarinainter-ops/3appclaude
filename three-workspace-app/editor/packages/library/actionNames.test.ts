import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTION_NAME_GLOSSARY, formatBilingual, translateActionName } from './actionNames'

test('offline glossary contains at least 200 curated action names from supported families', () => {
  assert.ok(Object.keys(ACTION_NAME_GLOSSARY).length >= 200)
  const names: Array<[string, string]> = [
    ['Idle', 'Đứng yên'], ['Walking', 'Đi bộ'], ['Running', 'Chạy'], ['Samba Dancing', 'Nhảy samba'],
    ['Jump', 'Nhảy lên'], ['Death', 'Chết'], ['Hit Reaction', 'Trúng đòn'], ['Stand', 'Đứng'],
    ['Attack', 'Tấn công'], ['Attack 1', 'Tấn công 1'], ['Stand 2', 'Đứng 2'], ['agree', 'Đồng ý'],
    ['Spell', 'Niệm phép'], ['Slam', 'Đập'], ['Victory', 'Chiến thắng'],
    ['Dissipate', 'Tan biến'], ['Cinematic', 'Điện ảnh'], ['crouching', 'Ngồi xổm'], ['sprinting', 'Chạy nước rút'],
    ['swipe', 'Vung tay'], ['emote_dab', 'Biểu cảm: dab'], ['emote_crying', 'Biểu cảm: khóc'],
    ['dying', 'Đang chết'], ['dead', 'Đã chết'], ['Walk Forward', 'Đi về trước'], ['Run Backward', 'Chạy lùi'],
    ['Turn 180', 'Quay 180 độ'], ['Hard Landing', 'Tiếp đất mạnh'], ['Crouch Walk', 'Đi khom'],
    ['Attack Spell', 'Tấn công bằng phép'], ['Sword Slash', 'Chém kiếm'], ['Rifle Shoot', 'Bắn súng trường'],
    ['Knockback', 'Bị đánh bật'], ['Stand Channel', 'Đứng vận phép'], ['Morph Alternate', 'Biến hình kiểu khác'],
    ['Silly Dancing', 'Nhảy vui nhộn'], ['Thumbs Up', 'Giơ ngón cái'], ['Wing Flap', 'Vỗ cánh'],
    ['Tail Idle', 'Đuôi đứng yên'], ['Jaw Open', 'Há miệng'], ['Celebration', 'Ăn mừng'],
  ]
  for (const [en, vi] of names) assert.deepEqual(translateActionName(en), { vi, source: 'glossary' }, en)
})

test('prefix cleanup, separators, camelCase, unknown words and numbers are deterministic', () => {
  assert.deepEqual(translateActionName('mixamo.com|Armature|Take 001|Walking'), { vi: 'Đi bộ', source: 'glossary' })
  assert.deepEqual(translateActionName('Armature|mixamo.com|Take001|Walking'), { vi: 'Đi bộ', source: 'glossary' })
  assert.deepEqual(translateActionName('Attack_Slam-1'), { vi: 'Tấn công đập 1', source: 'glossary' })
  assert.deepEqual(translateActionName('superAttack42'), { vi: 'Super tấn công 42', source: 'words' })
  assert.deepEqual(translateActionName('Mystery Foobar 7'), { vi: '', source: 'none' })
  assert.deepEqual(translateActionName(''), { vi: '', source: 'none' })
})

test('bilingual formatting omits empty or equivalent translations', () => {
  assert.equal(formatBilingual('Walk', 'Đi bộ'), 'Walk | Đi bộ')
  assert.equal(formatBilingual('Walk', ''), 'Walk')
  assert.equal(formatBilingual('Đi bộ', 'Đi bộ'), 'Đi bộ')
})
