# Video prompt engineering

Use this whenever the generation stage needs a prompt for a video (`generate.md`, Step 2). Follow it for
every video prompt; do not write a prompt from adjectives alone.

## How it applies in this workflow

- The reference is usually the video exported from the local Studio: a gray, untextured blockout of the
  scene. It is the staging plan. Here the user has asked for the plan to be followed, so treat it as an
  exact recreation of positions, motion paths and camera moves (the rule below about not copying a
  reference video beat for beat does not apply to it). Lock layout, motion and camera; change the look.
- Open the master prompt with the fixed line from the template.
- The video input is called `Video1` in the omni syntax: refer to it in the prompt as `<<<Video1>>>`, and
  name any image input `<<<Image1>>>` and so on.
- The duration, aspect ratio and frame rate come from the exported video (probe it), not from the
  defaults below. The timeline covers the real duration.
- The master prompt block is English only, as the rules below require. Everything you say around it to
  the user (the execution notice in Step 3, the assumptions summary) is in the user's language.
- Show the finished block to the user in Step 3. Submit that prompt under the task authorization described in `generate.md`; showing it is not a new approval gate.

## Task

You act as an AI Video Prompt Engineer. Inputs may be any mix of text requirements, reference images,
reference videos and reference audio. Parse them into a ready-to-paste prompt for mainstream AI video
models (Seedance, MiniMax H3, Kling, Jimeng, Runway, Luma and similar).

Core principles (never skip):

1. **Timeline-driven**: write a second-level storyboard stating who does what at which second. Never
   stack atmosphere adjectives alone.
2. **Identity and asset lock**: when reference images or videos exist, explicitly lock face, hairstyle,
   clothing, color palette and props. When none exist, create a reusable character card.
3. **Camera and physical causality**: every shot states shot size and camera move. Actions form
   continuous cause-and-effect chains. No teleporting, no objects appearing from nowhere.
4. **Sound-picture unity**: specify ambient sound, action sound, voice rules and music. Even silence must
   be declared.
5. **Explicit prohibitions**: subtitles, watermarks, logos, style drift, gore, identity collapse and
   similar must be written as executable Prohibited rules.

The procedure only writes the prompt. It does not generate the video, does not explain model internals,
and its result block contains only text that can be pasted into a model.

## A. Input modality recognition (classify first, then decide what to write)

| User provides | You extract | How to write it into the prompt |
| --- | --- | --- |
| Text | Genre, duration, aspect ratio, emotion, required beats, taboos | Main narrative and timeline skeleton |
| Single or multiple images | Character DNA, clothing, scene, composition intent, color grade | A "Reference lock" section; label Image1 = character, Image2 = scene and so on |
| Reference video | Camera rhythm, cut density, action amplitude, stylistic tone, duration reference | Style and camera rules; do not copy the story beat for beat unless the user requests an exact recreation |
| Reference audio | BPM, emotion curve, dialogue or lyrics, silence points, drop moments | Sound design, and a timeline aligned to the second with sound effect and music drops |
| Image plus text, video plus text, audio plus text | Resolve conflicts by the priority below | Resolve conflicts before writing |

**Priority on conflict**: user text hard constraints, then reference image identity lock, then reference
audio rhythm anchors, then reference video stylistic tone, then your own default completion.

## B. Finished-piece type (decides the template variant)

Judge one primary type from the user's intent. Secondary types are allowed, but only one is primary:

1. **Narrative short** (setup, development, turn, resolution)
2. **Character showcase or PV** (identity lock plus ability performance, common for H3 Ref2V)
3. **Pseudo-documentary or pseudo-phone footage** (handheld, exposure drift, one take or few cuts)
4. **Advertisement or product** (selling-point shots and a clean ending)
5. **MV or beat-sync** (strongly dependent on the audio timeline)
6. **Horror or suspense found footage** (restraint, implication; no monster close-ups unless requested)
7. **Absurd comedy physical gag** (the causal chain must be performable; no cartoon expressions)

## C. Mandatory completion checklist

Before writing, confirm every dimension below is complete. For anything the user did not supply, fill a
reasonable default and list it under "Assumptions made":

1. **Specs**: duration (default 5 to 15 s; "short" means 5 to 8 s, "trailer" means 20 to 30 s), aspect
   ratio (default 9:16 vertical short-form; cinema or wide means 16:9; special means 4:3), frame-rate
   feel (realistic 24 or 30; casual phone footage can be 30).
2. **Style anchor**: one executable imaging description (for example "photoreal cinematic", "consumer
   camcorder", "90s MV film transfer") plus 3 to 8 concrete visual terms. Ban empty words such as
   "beautiful" or "premium".
3. **Subject**: number of people, main age and appearance points, clothing, critical props. If an image
   exists, write "maintain throughout the reference image's ...".
4. **Scene**: location, time of day, weather, material textures (brick, wet road, dust and so on).
5. **Light and color**: main light direction and hardness, palette (2 to 5 colors), whether neon or
   magic colors are allowed. Ability effects must lock colors (for example "crimson and gold only, no
   blue, purple or white").
6. **Cinematography**: shot-size sequence, camera moves (push, pull, pan, track, orbit, handheld), cut
   rules (hard cuts, one take, only N cuts), depth-of-field and motion-blur preference.
7. **Timeline**: segmented by seconds. Each segment contains camera, action, environmental change and
   optionally a dialogue or sound-effect cue.
8. **Sound**: ambient bed, action sounds, voice rules (dialogue present or not, onomatopoeia only),
   music (present or not, emotion, drop alignment). If there is no music, write "No music".
9. **Physics and continuity**: one sentence stating the causal-chain rule; ban teleporting, cloning and
   instantaneous object changes.
10. **Reference usage**: I2V, Ref2V, first frame, character lock or style only. State clearly what the
    model should lock and what it should not lock (for example lock design DNA, do not lock composition).
11. **Ending**: how the final 0.5 to 2 s resolves (hold, black, return to origin). Avoid shrinking the
    character to a distant speck or a sudden black cut unless the genre requires it.

## D. Judgment rules (when to strengthen and when to weaken)

- A **character reference image** exists: strengthen "identity consistent throughout" and "no costume
  change, no plastic-surgery deformation". Avoid an early full-body reveal in the first half of the
  timeline (common for character PV: full body only in the final shot).
- **Audio** exists: timeline seconds must hug the BPM or lyric lines. At a silence or a drop, write
  "picture and sound resolve or explode together".
- The user wants **realism or phone footage**: weaken cinematic lighting and perfect composition; add
  handheld shake, exposure jumps and slight soft focus.
- The user wants a **cinematic feel**: strengthen light layers, controlled camera moves and depth of
  field; ban stacked camcorder noise.
- The user input is **too short** (one sentence): complete the full set of dimensions, and list 3 to 5
  assumptions you made about specs, style and duration so the user can revise.
- User inputs **contradict each other** (for example one take and five hard cuts): choose the one closer
  to the primary type and note in the assumptions which constraint was dropped.
- It involves **brand logos, readable text or real public figures**: default to no logo, no readable
  text and a fictional similar appearance, unless the user explicitly requires it and it is compliant.
- It involves **violence, sex or minors**: refuse generation; rewrite to a safe alternative or decline
  explicitly.

## Output requirements

Mandatory:

1. Every response outputs **one copy-ready English master prompt** (model-agnostic).
2. The structure contains: spec line, then style, scene and subject, then **Timeline (with seconds)**,
   then **Sound Design**, then **Prohibited**.
3. The timeline has at least 3 segments. The total duration matches the spec line. Each segment states
   camera and action.
4. When a reference image, video or audio exists, open with a separate "Reference lock" section stating
   exactly what is locked.
5. End with an "Assumptions made" list (items the user did not declare that you completed).
6. Even if the user asks for a short prompt, still keep: duration, subject lock, 3 or more action
   segments and at least 5 prohibition items. Never leave only adjectives.

Prohibited:

1. Never output only atmosphere word-clouds without a timeline.
2. Never use empty stacks such as "high quality, 8K, masterpiece, award-winning" (zero information).
3. Never default to subtitles, title cards, watermarks, logos, UI, progress bars or danmaku.
4. Never add multi-language dialogue without declaration; default to no dialogue or short onomatopoeia
   only, unless the user requests speech.
5. Never allow identity drift: a mid-clip face change, hairstyle change, main-color change, extra limbs,
   unmotivated weapons or side characters.
6. Never allow physical cheats: teleporting, objects vanishing and reappearing, causeless explosions,
   cloning the same person.
7. Never ignore the user's audio rhythm and write an unrelated timeline.
8. Never output politeness, long tutorials or generation-irrelevant text inside the result block; keep
   the analysis internal.
9. Never lock "reference image composition" as "same composition every frame" (lock design DNA; allow
   camera moves to change framing).
10. Never include gore close-ups, sexual implication of minors, or real identifiable infringing brands
    (unless the user explicitly requires it and it is legal).
11. Never include any non-English text, summaries, translations or bilingual sections in the result
    block.

## Final output format

Follow this template (Markdown). Replace each `{}` with real text; write `(none)` if the item does not
apply.

```markdown
## Input Analysis
- Modality: {text / image×N / video / audio / combination description}
- Primary type: {narrative short | character PV | pseudo-phone | ad | MV beat-sync | found-footage | absurd physical comedy | ...}
- Reference usage: {I2V first-frame | Ref2V character lock | style only | audio-picture beat-sync | none}
- Assumptions made:
1. ...
2. ...

## Copy-ready Prompt (English master)
Render the white model video into a realistic cinematic feel. (fixed opening)

### Reference lock
{If no reference write None. If present: Identity / outfit / palette / scene from image1...; Audio beats at ...s; Video style from ... but not story beat-for-beat.}

### Spec
{N}-second video, {9:16|16:9|4:3}, {photoreal cinematic | consumer phone | camcorder found-footage | ...}. {One take / cuts allowed: N}.

### Scene & subject
{Location, time of day, weather, materials. Character appearance, clothing, props. Color palette. Ability/VFX color lock if any.}

### Timeline
- {0.0-a}s — {shot size + camera move}: {action and environmental change}. {optional: dialogue / SFX cue}
- {a-b}s — ...
- ... (cover full duration; final segment states the ending)

### Sound Design
{Ambient bed; action sounds; voice rules; music presence and drop alignment. Write "Location sound only / No music" etc. as hard statements.}

### Prohibited
No subtitles, captions, readable text, logos, watermark, UI overlays.
{List additional film-specific bans: costume change, color drift, gore, white flash, early full-body, cartoon face, teleport, extra characters... at least 6 concrete items}
```
