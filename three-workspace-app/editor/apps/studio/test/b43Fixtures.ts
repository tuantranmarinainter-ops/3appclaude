import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCharacter, registerBaseModel, rebuildLibraryIndex } from '../../../packages/library/index';
import { bobjModelToGlb, parseBobjModel } from '../../../packages/retarget/src/bobjModel';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function fixture(root: string, temp: string) {
    const armature = readFileSync(path.resolve('apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8');
    const bobj = `${armature}\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\nan idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n`;
    const model = path.join(temp, 'mc20.bobj');
    writeFileSync(model, bobj.slice(0, bobj.lastIndexOf('\nan ')));
    const base = registerBaseModel({ name: 'B34 synthetic Minecraft', rig: 'minecraft20', modelFile: model });
    const den = createCharacter({ charId: 'b34-den', name: 'Đen', baseModelId: base.modelId });
    const hero = createCharacter({ charId: 'b34-hero', name: 'Hero', baseModelId: base.modelId });
    const source = Buffer.from(bobjModelToGlb(parseBobjModel(bobj)).bytes), actionUuid = randomUUID(), packId = '3400000000000001', pack = path.join(root, 'packs', packId);
    mkdirSync(pack, { recursive: true });
    writeFileSync(path.join(pack, 'anim.glb'), source);
    writeFileSync(path.join(pack, 'anim.bobj'), bobj.slice(bobj.lastIndexOf('\nan ') + 1));
    const action = { uuid: actionUuid, name: 'Synthetic wave', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, status: 'draft', version: 1, ownerCharId: den.charId, boundCharacter: den.charId, variantOf: actionUuid };
    writeFileSync(path.join(pack, 'meta.json'), JSON.stringify({ kind: 'motion-pack', libraryVersion: '1.1.0', packId, rig: 'minecraft20', glbSha256: sha(source), createdAt: '2026-10-26T00:00:00Z', license: { id: 'test', commitable: false }, actions: [action] }));
    writeFileSync(path.join(pack, 'anim.manifest.json'), JSON.stringify({ version: '1.0.0', rig: 'minecraft20', glbSha256: sha(source), actions: [action] }));
    const characterMeta = path.join(root, 'characters', den.charId, 'meta.json');
    writeFileSync(characterMeta, JSON.stringify({ ...JSON.parse(readFileSync(characterMeta, 'utf8')), actions: [actionUuid] }));
    // The production benchmark includes 300 independent pack metadata entries.
    for (let i = 1; i < 300; i++) {
        const id = String(BigInt('3400000000000001') + BigInt(i));
        const dir = path.join(root, 'packs', id);
        mkdirSync(dir, { recursive: true });
        const meta = JSON.parse(readFileSync(path.join(pack, 'meta.json'), 'utf8'));
        meta.packId = id;
        meta.actions = [{ ...action, uuid: randomUUID(), name: `Synthetic action ${i}`, ownerCharId: undefined, boundCharacter: undefined }];
        writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    }
    rebuildLibraryIndex();
    return { den, hero, actionUuid, pack, bobj };
}
