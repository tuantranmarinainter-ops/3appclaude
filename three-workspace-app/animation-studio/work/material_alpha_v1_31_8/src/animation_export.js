import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function bake(buffer, fps) {
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw Error('FPS xuất không hợp lệ.');
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const clip = gltf.animations[0];
  if (!clip) throw Error('Không có animation để xuất.');
  const objects = [];
  gltf.scene.traverse((object) => {
    if (object.isBone || object.userData.studioJoint) objects.push(object);
  });
  if (!objects.length)
    gltf.scene.traverse((object) => {
      if (
        object.name &&
        clip.tracks.some(
          (track) =>
            track.name.startsWith(object.name + '.') || track.name.startsWith(object.uuid + '.'),
        )
      )
        objects.push(object);
    });
  const set = new Set(objects),
    nodes = [
      {
        name: 'AnimationStudioRoot',
        parent: -1,
        rest: { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      },
    ];
  const localPose = (object) => {
    let parent = object.parent;
    while (parent && !set.has(parent)) parent = parent.parent;
    const matrix = object.matrixWorld.clone();
    if (parent) matrix.premultiply(parent.matrixWorld.clone().invert());
    const position = new T.Vector3(),
      rotation = new T.Quaternion(),
      scale = new T.Vector3();
    matrix.decompose(position, rotation, scale);
    return { parent, p: position.toArray(), q: rotation.normalize().toArray(), s: scale.toArray() };
  };
  gltf.scene.updateMatrixWorld(true);
  for (const object of objects) {
    const pose = localPose(object);
    nodes.push({
      name: object.name || 'Joint' + nodes.length,
      parent: pose.parent ? objects.indexOf(pose.parent) + 1 : 0,
      rest: pose,
    });
  }
  const mixer = new T.AnimationMixer(gltf.scene),
    action = mixer.clipAction(clip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const count = Math.ceil(clip.duration * fps) + 1,
    frames = [],
    times = [];
  if (count * nodes.length > 2000000) throw Error('Animation quá lớn để xuất trực tiếp.');
  for (let index = 0; index < count; index++) {
    const time = Math.min(clip.duration, index / fps);
    times.push(time);
    mixer.setTime(time);
    gltf.scene.updateMatrixWorld(true);
    frames.push([nodes[0].rest, ...objects.map(localPose)]);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  if (
    frames.some((frame) =>
      frame.some((pose) =>
        [...pose.p, ...pose.q, ...pose.s].some((value) => !Number.isFinite(value)),
      ),
    )
  )
    throw Error('Transform xuất có giá trị không hợp lệ.');
  const worlds = (poses) => {
    const matrices = [];
    return poses.map((pose, index) => {
      const matrix = new T.Matrix4().compose(
          new T.Vector3().fromArray(pose.p),
          new T.Quaternion().fromArray(pose.q),
          new T.Vector3().fromArray(pose.s),
        ),
        parent = nodes[index].parent;
      if (parent >= 0) matrix.premultiply(matrices[parent]);
      matrices.push(matrix);
      return matrix;
    });
  };
  const restWorld = worlds(nodes.map((bone) => bone.rest)),
    restScales = restWorld.map((matrix) => new T.Vector3().setFromMatrixScale(matrix));
  if (
    restScales.some((scale) =>
      scale.toArray().some((value) => !Number.isFinite(value) || Math.abs(value) < 1e-8),
    )
  )
    throw Error('Scale gốc bằng 0 hoặc không hợp lệ; không thể xuất skeleton này.');
  const normalize = (poses) => {
    const originalWorld = worlds(poses),
      normalizedWorld = originalWorld.map((matrix, index) =>
        matrix
          .clone()
          .multiply(
            new T.Matrix4().makeScale(
              1 / restScales[index].x,
              1 / restScales[index].y,
              1 / restScales[index].z,
            ),
          ),
      );
    return normalizedWorld.map((matrix, index) => {
      const local = matrix.clone(),
        parent = nodes[index].parent;
      if (parent >= 0) local.premultiply(normalizedWorld[parent].clone().invert());
      const position = new T.Vector3(),
        rotation = new T.Quaternion(),
        scale = new T.Vector3();
      local.decompose(position, rotation, scale);
      return { p: position.toArray(), q: rotation.normalize().toArray(), s: scale.toArray() };
    });
  };
  const rest = normalize(nodes.map((bone) => bone.rest));
  return {
    nodes: nodes.map((bone, index) => ({ ...bone, rest: rest[index] })),
    frames: frames.map(normalize),
    times,
    fps,
    duration: clip.duration,
    name: clip.name,
  };
}

function rotations(animation, order = 'ZYX') {
  const previous = animation.nodes.map(() => [0, 0, 0]);
  return animation.frames.map((frame) =>
    frame.map((pose, index) => {
      const euler = new T.Euler().setFromQuaternion(new T.Quaternion().fromArray(pose.q), order);
      const values = [euler.x, euler.y, euler.z].map(T.MathUtils.radToDeg);
      for (let axis = 0; axis < 3; axis++) {
        values[axis] += Math.round((previous[index][axis] - values[axis]) / 360) * 360;
      }
      previous[index] = values;
      return values;
    }),
  );
}
const number = (value) => (Math.abs(value) < 1e-9 ? '0' : Number(value.toFixed(8)).toString());

export function bvh(animation) {
  if (
    animation.frames.some((frame) =>
      frame.some((pose, index) =>
        pose.s.some((value, axis) => Math.abs(value - animation.nodes[index].rest.s[axis]) > 1e-5),
      ),
    )
  )
    throw Error('BVH không chứa Scale. Chọn FBX để giữ biến dạng/tỉ lệ.');
  const worldPoses = (poses) => {
    const worlds = [];
    return poses.map((pose, index) => {
      const matrix = new T.Matrix4().compose(
          new T.Vector3().fromArray(pose.p),
          new T.Quaternion().fromArray(pose.q),
          new T.Vector3().fromArray(pose.s),
        ),
        parent = animation.nodes[index].parent;
      if (parent >= 0) matrix.premultiply(worlds[parent].matrix);
      const position = new T.Vector3(),
        rotation = new T.Quaternion(),
        scale = new T.Vector3();
      matrix.decompose(position, rotation, scale);
      const result = { matrix, position, rotation };
      worlds.push(result);
      return result;
    });
  };
  const restWorld = worldPoses(animation.nodes.map((bone) => bone.rest));
  const frames = animation.frames.map((frame) => {
    const worlds = worldPoses(frame),
      deltas = worlds.map((world, index) =>
        world.rotation.clone().multiply(restWorld[index].rotation.clone().invert()),
      );
    return worlds.map((world, index) => {
      const parent = animation.nodes[index].parent,
        position = world.position.clone(),
        rotation = deltas[index].clone();
      if (parent >= 0) {
        position.sub(worlds[parent].position).applyQuaternion(deltas[parent].clone().invert());
        rotation.premultiply(deltas[parent].clone().invert());
      }
      return { p: position.toArray(), q: rotation.normalize().toArray(), s: [1, 1, 1] };
    });
  });
  animation = {
    ...animation,
    nodes: animation.nodes.map((bone, index) => ({
      ...bone,
      rest: {
        p: restWorld[index].position
          .clone()
          .sub(bone.parent >= 0 ? restWorld[bone.parent].position : new T.Vector3())
          .toArray(),
        q: [0, 0, 0, 1],
        s: [1, 1, 1],
      },
    })),
    frames,
  };
  const lines = ['HIERARCHY'],
    order = [];
  function joint(index, depth) {
    const node = animation.nodes[index],
      indent = '  '.repeat(depth),
      name = node.name.replace(/\s/g, '_').replace(/[{}:]/g, '_');
    order.push(index);
    lines.push(
      indent + (index ? 'JOINT ' : 'ROOT ') + name,
      indent + '{',
      indent + '  OFFSET ' + node.rest.p.map(number).join(' '),
      indent + '  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation',
    );
    const children = animation.nodes.flatMap((other, child) =>
      other.parent === index ? [child] : [],
    );
    children.forEach((child) => joint(child, depth + 1));
    if (!children.length)
      lines.push(
        indent + '  End Site',
        indent + '  {',
        indent + '    OFFSET 0 0.01 0',
        indent + '  }',
      );
    lines.push(indent + '}');
  }
  joint(0, 0);
  lines.push(
    'MOTION',
    'Frames: ' + animation.frames.length,
    'Frame Time: ' + number(1 / animation.fps),
  );
  const angles = rotations(animation, 'ZXY');
  animation.frames.forEach((frame, frameIndex) =>
    lines.push(
      order
        .flatMap((index) => [
          ...frame[index].p,
          angles[frameIndex][index][2],
          angles[frameIndex][index][0],
          angles[frameIndex][index][1],
        ])
        .map(number)
        .join(' '),
    ),
  );
  return lines.join('\n') + '\n';
}

const textEncoder = new TextEncoder();
function property(type, value) {
  const array = ['i', 'l', 'f', 'd'].includes(type),
    bytes = array
      ? type === 'i' || type === 'f'
        ? 4
        : 8
      : type === 'S'
        ? textEncoder.encode(value).length
        : type === 'L' || type === 'D'
          ? 8
          : 4;
  const output = new Uint8Array(
      1 + (array ? 12 + value.length * bytes : type === 'S' ? 4 + bytes : bytes),
    ),
    view = new DataView(output.buffer);
  output[0] = type.charCodeAt(0);
  const write = (offset, item) => {
    if (type === 'L' || type === 'l') view.setBigInt64(offset, BigInt(item), true);
    else if (type === 'D' || type === 'd') view.setFloat64(offset, item, true);
    else if (type === 'F' || type === 'f') view.setFloat32(offset, item, true);
    else view.setInt32(offset, item, true);
  };
  if (array) {
    view.setUint32(1, value.length, true);
    view.setUint32(5, 0, true);
    view.setUint32(9, value.length * bytes, true);
    value.forEach((item, index) => write(13 + index * bytes, item));
  } else if (type === 'S') {
    view.setUint32(1, bytes, true);
    output.set(textEncoder.encode(value), 5);
  } else write(1, value);
  return output;
}
function encodeNode(node, offset) {
  const name = textEncoder.encode(node.name),
    properties = node.props.map(([type, value]) => property(type, value)),
    propertySize = properties.reduce((sum, bytes) => sum + bytes.length, 0);
  let length = 13 + name.length + propertySize;
  const children = [];
  for (const child of node.children) {
    const bytes = encodeNode(child, offset + length);
    children.push(bytes);
    length += bytes.length;
  }
  if (children.length) length += 13;
  const output = new Uint8Array(length),
    view = new DataView(output.buffer);
  view.setUint32(0, offset + length, true);
  view.setUint32(4, properties.length, true);
  view.setUint32(8, propertySize, true);
  output[12] = name.length;
  output.set(name, 13);
  let cursor = 13 + name.length;
  for (const bytes of [...properties, ...children]) {
    output.set(bytes, cursor);
    cursor += bytes.length;
  }
  return output;
}
const node = (name, props = [], children = []) => ({ name, props, children });
const string = (value) => ['S', value],
  integer = (value) => ['I', value],
  long = (value) => ['L', value],
  decimal = (value) => ['D', value];
const field = (name, type, value) =>
  node('P', [
    string(name),
    string(type),
    string(type === 'double' ? 'Number' : type === 'int' ? 'Integer' : ''),
    string(''),
    ...(Array.isArray(value)
      ? value.map(decimal)
      : [
          type === 'KTime'
            ? long(value)
            : type === 'int' || type === 'enum' || type === 'bool'
              ? integer(value)
              : decimal(value),
        ]),
  ]);

export function fbx(animation, up = 'z') {
  const ticks = 46186158000,
    angles = rotations(animation),
    objects = [],
    connections = [],
    connect = (kind, from, to, label) =>
      connections.push(
        node('C', [string(kind), long(from), long(to), ...(label ? [string(label)] : [])]),
      );
  let next = 1000;
  const ids = animation.nodes.map(() => next++),
    stack = next++,
    layer = next++;
  const end = Math.round(animation.duration * ticks);
  objects.push(
    node(
      'AnimationStack',
      [long(stack), string(animation.name + '\0\x01AnimStack'), string('')],
      [
        node(
          'Properties70',
          [],
          [
            field('LocalStart', 'KTime', 0),
            field('LocalStop', 'KTime', end),
            field('ReferenceStart', 'KTime', 0),
            field('ReferenceStop', 'KTime', end),
          ],
        ),
      ],
    ),
  );
  objects.push(
    node('AnimationLayer', [long(layer), string('BaseLayer\0\x01AnimLayer'), string('')]),
  );
  connect('OO', layer, stack);
  animation.nodes.forEach((bone, index) => {
    const restAngles = new T.Euler().setFromQuaternion(
      new T.Quaternion().fromArray(bone.rest.q),
      'ZYX',
    );
    objects.push(
      node(
        'Model',
        [long(ids[index]), string(bone.name + '\0\x01Model'), string('LimbNode')],
        [
          node('Version', [integer(232)]),
          node(
            'Properties70',
            [],
            [
              field('Lcl Translation', 'Lcl Translation', bone.rest.p),
              field(
                'Lcl Rotation',
                'Lcl Rotation',
                [restAngles.x, restAngles.y, restAngles.z].map(T.MathUtils.radToDeg),
              ),
              field('Lcl Scaling', 'Lcl Scaling', bone.rest.s),
              field('RotationOrder', 'enum', 0),
              field('RotationActive', 'bool', 1),
            ],
          ),
          node('Shading', [integer(1)]),
          node('Culling', [string('CullingOff')]),
        ],
      ),
    );
    const attribute = next++;
    objects.push(
      node(
        'NodeAttribute',
        [long(attribute), string(bone.name + '\0\x01NodeAttribute'), string('LimbNode')],
        [
          node('TypeFlags', [string('Skeleton')]),
          node('Properties70', [], [field('Size', 'double', 0.1)]),
        ],
      ),
    );
    connect('OO', attribute, ids[index]);
    connect('OO', ids[index], bone.parent < 0 ? 0 : ids[bone.parent]);
    for (const [channel, propertyName, selector] of [
      ['T', 'Lcl Translation', (frame) => animation.frames[frame][index].p],
      ['R', 'Lcl Rotation', (frame) => angles[frame][index]],
      ['S', 'Lcl Scaling', (frame) => animation.frames[frame][index].s],
    ]) {
      const curveNode = next++;
      objects.push(
        node(
          'AnimationCurveNode',
          [long(curveNode), string(channel + '\0\x01AnimCurveNode'), string('')],
          [
            node(
              'Properties70',
              [],
              ['X', 'Y', 'Z'].map((axis, axisIndex) =>
                field('d|' + axis, 'Number', selector(0)[axisIndex]),
              ),
            ),
          ],
        ),
      );
      connect('OO', curveNode, layer);
      connect('OP', curveNode, ids[index], propertyName);
      for (const [axisIndex, axis] of ['X', 'Y', 'Z'].entries()) {
        const curve = next++;
        objects.push(
          node(
            'AnimationCurve',
            [long(curve), string('Curve\0\x01AnimCurve'), string('')],
            [
              node('Default', [decimal(selector(0)[axisIndex])]),
              node('KeyVer', [integer(4008)]),
              node('KeyTime', [['l', animation.times.map((time) => Math.round(time * ticks))]]),
              node('KeyValueFloat', [
                ['f', animation.times.map((time, frame) => selector(frame)[axisIndex])],
              ]),
              node('KeyAttrFlags', [['i', [24836]]]),
              node('KeyAttrDataFloat', [['f', [0, 0, 0, 0]]]),
              node('KeyAttrRefCount', [['i', [animation.frames.length]]]),
            ],
          ),
        );
        connect('OP', curve, curveNode, 'd|' + axis);
      }
    }
  });
  const settings = [
    field('UpAxis', 'int', up === 'z' ? 2 : 1),
    field('UpAxisSign', 'int', 1),
    field('FrontAxis', 'int', up === 'z' ? 1 : 2),
    field('FrontAxisSign', 'int', up === 'z' ? -1 : 1),
    field('CoordAxis', 'int', 0),
    field('CoordAxisSign', 'int', 1),
    field('UnitScaleFactor', 'double', 100),
    field('OriginalUnitScaleFactor', 'double', 100),
    field('TimeMode', 'enum', 14),
    field('CustomFrameRate', 'double', animation.fps),
  ];
  const tree = [
    node(
      'FBXHeaderExtension',
      [],
      [
        node('FBXHeaderVersion', [integer(1003)]),
        node('FBXVersion', [integer(7400)]),
        node('Creator', [string('Animation Studio')]),
      ],
    ),
    node(
      'GlobalSettings',
      [],
      [node('Version', [integer(1000)]), node('Properties70', [], settings)],
    ),
    node('Objects', [], objects),
    node('Connections', [], connections),
    node('Takes', [], [node('Current', [string(animation.name)])]),
  ];
  const header = new Uint8Array(27);
  header.set(textEncoder.encode('Kaydara FBX Binary  \0\x1a\0'));
  new DataView(header.buffer).setUint32(23, 7400, true);
  let offset = 27;
  const chunks = [header];
  for (const entry of tree) {
    const bytes = encodeNode(entry, offset);
    chunks.push(bytes);
    offset += bytes.length;
  }
  chunks.push(new Uint8Array(13));
  const padding = (16 - ((offset + 33) % 16)) % 16 || 16,
    footer = new Uint8Array(160 + padding);
  footer.set([250, 188, 171, 9, 208, 200, 212, 102, 177, 118, 251, 131, 28, 247, 38, 126]);
  new DataView(footer.buffer).setUint32(20 + padding, 7400, true);
  footer.set(
    [248, 90, 140, 106, 222, 245, 217, 126, 236, 233, 12, 227, 117, 143, 41, 11],
    144 + padding,
  );
  chunks.push(footer);
  const output = new Uint8Array(offset + 13 + footer.length);
  let cursor = 0;
  for (const bytes of chunks) {
    output.set(bytes, cursor);
    cursor += bytes.length;
  }
  return output.buffer;
}
