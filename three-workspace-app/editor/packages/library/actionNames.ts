export type ActionNameTranslationSource = 'glossary' | 'words' | 'none'

// Stable, offline names collected from the action families accepted by App 1.
// Keys are normalized to lower-case words so punctuation and filename conventions do not leak into metadata.
export const ACTION_NAME_GLOSSARY: Readonly<Record<string, string>> = Object.freeze({
  'idle': 'Đứng yên', 'idle 1': 'Đứng yên 1', 'idle 2': 'Đứng yên 2', 'idle looking': 'Đứng yên quan sát',
  'idle breathing': 'Đứng yên thở', 'idle happy': 'Đứng yên vui vẻ', 'idle sad': 'Đứng yên buồn', 'idle angry': 'Đứng yên tức giận',
  'standing idle': 'Đứng yên', 'sitting idle': 'Ngồi yên', 'combat idle': 'Tư thế chiến đấu', 'rifle idle': 'Đứng yên cầm súng trường',
  'pistol idle': 'Đứng yên cầm súng ngắn', 'sword idle': 'Đứng yên cầm kiếm', 'zombie idle': 'Xác sống đứng yên', 'mutant idle': 'Dị nhân đứng yên',
  'walk': 'Đi bộ', 'walking': 'Đi bộ', 'walking 1': 'Đi bộ 1', 'walking 2': 'Đi bộ 2', 'walk forward': 'Đi về trước',
  'walk backward': 'Đi lùi', 'walk left': 'Đi sang trái', 'walk right': 'Đi sang phải', 'walk in circle': 'Đi vòng tròn',
  'slow walk': 'Đi chậm', 'happy walk': 'Đi vui vẻ', 'sad walk': 'Đi buồn bã', 'injured walk': 'Đi bị thương',
  'run': 'Chạy', 'running': 'Chạy', 'running 1': 'Chạy 1', 'running 2': 'Chạy 2', 'run forward': 'Chạy về trước',
  'run backward': 'Chạy lùi', 'run left': 'Chạy sang trái', 'run right': 'Chạy sang phải', 'jog': 'Chạy nhẹ', 'jogging': 'Chạy nhẹ',
  'sprint': 'Chạy nước rút', 'sprinting': 'Chạy nước rút', 'strafe left': 'Lách sang trái', 'strafe right': 'Lách sang phải',
  'turn left': 'Quay trái', 'turn right': 'Quay phải', 'turn 90 left': 'Quay trái 90 độ', 'turn 90 right': 'Quay phải 90 độ',
  'turn 180': 'Quay 180 độ', 'jump': 'Nhảy lên', 'jumping': 'Nhảy lên', 'jump start': 'Bắt đầu nhảy', 'jump loop': 'Lặp trên không',
  'jump land': 'Tiếp đất', 'running jump': 'Chạy lấy đà nhảy', 'standing jump': 'Nhảy tại chỗ', 'long jump': 'Nhảy xa',
  'high jump': 'Nhảy cao', 'fall': 'Ngã', 'falling': 'Đang rơi', 'falling idle': 'Rơi tự do', 'hard landing': 'Tiếp đất mạnh',
  'roll': 'Lăn người', 'forward roll': 'Lộn về trước', 'backward roll': 'Lộn về sau', 'dodge': 'Né tránh',
  'dodge left': 'Né sang trái', 'dodge right': 'Né sang phải', 'crouch': 'Ngồi xổm', 'crouching': 'Ngồi xổm',
  'crouch idle': 'Ngồi xổm yên', 'crouch walk': 'Đi khom', 'crawl': 'Bò', 'crawling': 'Đang bò',
  'climb': 'Leo trèo', 'climbing': 'Đang leo', 'climb up': 'Leo lên', 'climb down': 'Leo xuống', 'swim': 'Bơi',
  'swimming': 'Đang bơi', 'fly': 'Bay', 'flying': 'Đang bay', 'hover': 'Bay lơ lửng', 'sneak': 'Đi lén',
  'sneaking': 'Đang đi lén', 'attack': 'Tấn công', 'attack 1': 'Tấn công 1', 'attack 2': 'Tấn công 2', 'attack 3': 'Tấn công 3',
  'attack slam': 'Tấn công đập', 'attack slam 1': 'Tấn công đập 1', 'melee attack': 'Tấn công cận chiến', 'heavy attack': 'Tấn công mạnh',
  'light attack': 'Tấn công nhẹ', 'special attack': 'Tấn công đặc biệt', 'combo attack': 'Liên hoàn tấn công', 'punch': 'Đấm',
  'punching': 'Đang đấm', 'right punch': 'Đấm phải', 'left punch': 'Đấm trái', 'hook punch': 'Đấm móc',
  'uppercut': 'Đấm móc lên', 'kick': 'Đá', 'kicking': 'Đang đá', 'front kick': 'Đá trước', 'side kick': 'Đá ngang',
  'roundhouse kick': 'Đá vòng cầu', 'low kick': 'Đá thấp', 'high kick': 'Đá cao', 'headbutt': 'Húc đầu',
  'slash': 'Chém', 'slash 1': 'Chém 1', 'slash 2': 'Chém 2', 'sword slash': 'Chém kiếm', 'stab': 'Đâm',
  'thrust': 'Đâm tới', 'swing': 'Vung', 'swipe': 'Vung tay', 'slam': 'Đập', 'smash': 'Nện', 'bash': 'Nện mạnh',
  'shoot': 'Bắn', 'shooting': 'Đang bắn', 'rifle shoot': 'Bắn súng trường', 'pistol shoot': 'Bắn súng ngắn',
  'bow shot': 'Bắn cung', 'throw': 'Ném', 'throwing': 'Đang ném', 'block': 'Đỡ đòn', 'blocking': 'Đang đỡ đòn',
  'parry': 'Gạt đòn', 'hit': 'Trúng đòn', 'hit reaction': 'Trúng đòn', 'hit reaction 1': 'Trúng đòn 1',
  'hit reaction 2': 'Trúng đòn 2', 'head hit': 'Trúng đầu', 'body hit': 'Trúng thân', 'knockback': 'Bị đánh bật',
  'stunned': 'Choáng', 'death': 'Chết', 'death 1': 'Chết 1', 'death 2': 'Chết 2', 'dying': 'Đang chết', 'dead': 'Đã chết',
  'knockdown': 'Bị đánh ngã', 'get up': 'Đứng dậy', 'revive': 'Hồi sinh', 'stand': 'Đứng', 'stand 1': 'Đứng 1',
  'stand 2': 'Đứng 2', 'stand ready': 'Đứng sẵn sàng', 'stand victory': 'Đứng chiến thắng', 'stand channel': 'Đứng vận phép',
  'stand work': 'Đứng làm việc', 'stand lumber': 'Đứng đốn gỗ', 'stand gold': 'Đứng mang vàng', 'stand alternate': 'Đứng kiểu khác',
  'attack alternate': 'Tấn công kiểu khác', 'attack spell': 'Tấn công bằng phép', 'spell': 'Niệm phép', 'spell 1': 'Niệm phép 1',
  'spell 2': 'Niệm phép 2', 'spell channel': 'Duy trì phép', 'spell throw': 'Ném phép', 'spell slam': 'Đập phép',
  'channel': 'Vận phép', 'birth': 'Xuất hiện', 'decay': 'Phân rã', 'dissipate': 'Tan biến', 'morph': 'Biến hình',
  'morph alternate': 'Biến hình kiểu khác', 'victory': 'Chiến thắng', 'cinematic': 'Điện ảnh', 'portrait': 'Chân dung',
  'talk': 'Nói chuyện', 'talking': 'Đang nói chuyện', 'shout': 'Hét', 'roar': 'Gầm', 'laugh': 'Cười', 'laughing': 'Đang cười',
  'cry': 'Khóc', 'crying': 'Đang khóc', 'yawn': 'Ngáp', 'sleep': 'Ngủ', 'sleeping': 'Đang ngủ', 'wake up': 'Thức dậy',
  'sit': 'Ngồi', 'sitting': 'Đang ngồi', 'sit down': 'Ngồi xuống', 'stand up': 'Đứng lên', 'lie down': 'Nằm xuống',
  'lying': 'Đang nằm', 'kneel': 'Quỳ', 'kneeling': 'Đang quỳ', 'dance': 'Nhảy múa', 'dancing': 'Đang nhảy múa',
  'samba dancing': 'Nhảy samba', 'hip hop dancing': 'Nhảy hip hop', 'breakdance': 'Nhảy breakdance', 'silly dancing': 'Nhảy vui nhộn',
  'wave': 'Vẫy tay', 'waving': 'Đang vẫy tay', 'clap': 'Vỗ tay', 'clapping': 'Đang vỗ tay', 'point': 'Chỉ tay',
  'pointing': 'Đang chỉ tay', 'thumbs up': 'Giơ ngón cái', 'salute': 'Chào kiểu quân đội', 'bow': 'Cúi chào',
  'nod': 'Gật đầu', 'shake head': 'Lắc đầu', 'shrug': 'Nhún vai', 'pray': 'Cầu nguyện', 'thinking': 'Suy nghĩ',
  'look around': 'Nhìn quanh', 'look left': 'Nhìn trái', 'look right': 'Nhìn phải', 'look up': 'Nhìn lên', 'look down': 'Nhìn xuống',
  'agree': 'Đồng ý',
  'pick up': 'Nhặt lên', 'put down': 'Đặt xuống', 'push': 'Đẩy', 'pull': 'Kéo', 'carry': 'Mang', 'carry heavy': 'Mang vật nặng',
  'open': 'Mở', 'close': 'Đóng', 'drink': 'Uống', 'eating': 'Đang ăn', 'dig': 'Đào', 'mining': 'Đào mỏ',
  'chop': 'Chặt', 'building': 'Đang xây', 'crafting': 'Đang chế tạo', 'fishing': 'Đang câu cá', 'rowing': 'Đang chèo thuyền',
  'riding': 'Đang cưỡi', 'emote dab': 'Biểu cảm: dab', 'emote crying': 'Biểu cảm: khóc', 'emote waving': 'Biểu cảm: vẫy tay',
  'emote clapping': 'Biểu cảm: vỗ tay', 'emote laughing': 'Biểu cảm: cười', 'emote dancing': 'Biểu cảm: nhảy múa',
  'emote facepalm': 'Biểu cảm: ôm mặt', 'emote shrug': 'Biểu cảm: nhún vai', 'emote salute': 'Biểu cảm: chào',
  'emote cheering': 'Biểu cảm: reo mừng', 'emote thinking': 'Biểu cảm: suy nghĩ', 'emote angry': 'Biểu cảm: tức giận',
  'emote sad': 'Biểu cảm: buồn', 'emote happy': 'Biểu cảm: vui', 'wing flap': 'Vỗ cánh', 'wing idle': 'Cánh đứng yên',
  'tail idle': 'Đuôi đứng yên', 'jaw open': 'Há miệng', 'jaw close': 'Ngậm miệng', 'greeting': 'Chào hỏi',
  'celebration': 'Ăn mừng', 'fear': 'Sợ hãi', 'surprised': 'Ngạc nhiên', 'angry': 'Tức giận', 'happy': 'Vui vẻ',
  'sad': 'Buồn', 'tired': 'Mệt mỏi', 'injured': 'Bị thương', 'ready': 'Sẵn sàng', 'guard': 'Canh gác',
})

const WORDS: Readonly<Record<string, string>> = Object.freeze({
  idle: 'đứng yên', stand: 'đứng', standing: 'đứng', walk: 'đi bộ', walking: 'đi bộ', run: 'chạy', running: 'chạy',
  sprint: 'chạy nước rút', sprinting: 'chạy nước rút', jump: 'nhảy lên', jumping: 'nhảy lên', attack: 'tấn công',
  slam: 'đập', spell: 'niệm phép', death: 'chết', dying: 'đang chết', dead: 'đã chết', hit: 'trúng đòn', reaction: 'phản ứng',
  emote: 'biểu cảm:', crying: 'khóc', dancing: 'nhảy múa', dance: 'nhảy múa', crouch: 'ngồi xổm', crouching: 'ngồi xổm',
  swipe: 'vung tay', victory: 'chiến thắng', cinematic: 'điện ảnh', dissipate: 'tan biến', forward: 'về trước',
  backward: 'lùi', left: 'trái', right: 'phải', up: 'lên', down: 'xuống', turn: 'quay', slow: 'chậm', fast: 'nhanh',
  happy: 'vui vẻ', sad: 'buồn', angry: 'tức giận', injured: 'bị thương', heavy: 'mạnh', light: 'nhẹ', sword: 'kiếm',
  rifle: 'súng trường', pistol: 'súng ngắn', shoot: 'bắn', throw: 'ném', block: 'đỡ đòn', kick: 'đá', punch: 'đấm',
  talk: 'nói chuyện', wave: 'vẫy tay', clap: 'vỗ tay', sit: 'ngồi', sleep: 'ngủ', fly: 'bay', swim: 'bơi',
  climb: 'leo', fall: 'ngã', falling: 'đang rơi', roll: 'lăn người', dodge: 'né', ready: 'sẵn sàng', alternate: 'kiểu khác',
  loop: 'lặp', start: 'bắt đầu', land: 'tiếp đất', open: 'mở', close: 'đóng', wing: 'cánh', tail: 'đuôi', jaw: 'hàm',
})

function cleanActionName(value: string): string {
  let result = value.trim()
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result.replace(/^(?:(?:mixamo\.com|armature|take[ _-]*0*01)[|:_\s-]*)/i, '')
  }
  return result.trim() || value.trim()
}

function words(value: string): string[] {
  return cleanActionName(value)
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/[_|.-]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean)
}

function key(value: string): string { return words(value).join(' ').toLocaleLowerCase('en-US') }

function sentenceCase(value: string): string {
  return value ? value[0]!.toLocaleUpperCase('vi-VN') + value.slice(1) : value
}

export function translateActionName(en: string): { vi: string; source: ActionNameTranslationSource } {
  if (typeof en !== 'string' || !en.trim()) return { vi: '', source: 'none' }
  const normalized = key(en)
  const exact = ACTION_NAME_GLOSSARY[normalized]
  if (exact) return { vi: exact, source: 'glossary' }
  const tokens = words(en)
  let translated = false
  const composed = tokens.map((token) => {
    if (/^\d+$/.test(token)) return token
    const replacement = WORDS[token.toLocaleLowerCase('en-US')]
    if (replacement) translated = true
    return replacement ?? token
  }).join(' ').replace(/:\s+/g, ': ')
  return translated ? { vi: sentenceCase(composed), source: 'words' } : { vi: '', source: 'none' }
}

export function formatBilingual(en: string, vi?: string): string {
  const english = en.trim(), vietnamese = vi?.trim() ?? ''
  return !vietnamese || vietnamese.localeCompare(english, undefined, { sensitivity: 'accent' }) === 0 ? english : `${english} | ${vietnamese}`
}
