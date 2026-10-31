// SPDX-License-Identifier: GPL-3.0-or-later
// Export panel section for Minecraft Bedrock animation JSON; the same DOM is used by both layouts.
export function installBedrockPanel(host, actions) {
  const section = document.createElement('details');
  section.id = 'bedrockPanel';
  section.className = 'bedrock-panel';
  section.innerHTML = `<summary>Bedrock · animation JSON</summary>
    <small>Trao đổi với Blockbench, GeckoLib và Minecraft Bedrock (.animation.json).</small>
    <div class="row"><button id="bedrockExport" type="button">Xuất .animation.json</button>
      <label class="button">Nhập .animation.json<input id="bedrockImportInput" type="file" accept=".json,application/json"></label></div>
    <label class="field" id="bedrockPickWrap" hidden>Animation trong tệp<select id="bedrockPick"></select></label>
    <div id="bedrockMapping" class="bedrock-mapping" hidden></div>
    <button id="bedrockApply" type="button" hidden>Nhập vào animation hiện tại</button>
    <output id="bedrockStatus" class="summary" role="status" aria-live="polite"></output>`;
  host.append(section);
  const $ = (id) => section.querySelector('#' + id);
  let parsed = null;
  const status = (text) => {
    $('bedrockStatus').textContent = text;
  };
  const reset = () => {
    parsed = null;
    $('bedrockPickWrap').hidden = $('bedrockMapping').hidden = $('bedrockApply').hidden = true;
    $('bedrockMapping').replaceChildren();
  };
  function showMapping() {
    const plan = actions.plan(parsed, $('bedrockPick').value);
    const box = $('bedrockMapping');
    box.replaceChildren();
    if (plan.unmatched.length) {
      const note = document.createElement('small');
      note.textContent = 'Xương không trùng tên — chọn xương tương ứng hoặc bỏ qua:';
      box.append(note);
      for (const name of plan.unmatched) {
        const label = document.createElement('label');
        label.className = 'field';
        label.textContent = name;
        const select = document.createElement('select');
        select.dataset.bone = name;
        select.append(new Option('Bỏ qua', ''));
        for (const bone of plan.bones) select.append(new Option(bone.name, bone.id));
        label.append(select);
        box.append(label);
      }
    }
    box.hidden = !plan.unmatched.length;
    $('bedrockApply').hidden = false;
    status(`${Object.keys(plan.mapping).length} xương khớp tên, ${plan.unmatched.length} xương cần chọn.`);
    return plan;
  }
  $('bedrockExport').addEventListener('click', () => run());
  $('bedrockImportInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    try {
      parsed = actions.parse(await file.text());
      const pick = $('bedrockPick');
      pick.replaceChildren(...parsed.names.map((n) => new Option(n, n)));
      $('bedrockPickWrap').hidden = parsed.names.length < 2;
      showMapping();
    } catch (error) {
      status(error.message);
    }
  });
  $('bedrockPick').addEventListener('change', () => parsed && showMapping());
  $('bedrockApply').addEventListener('click', () => {
    if (!parsed) return;
    try {
      const plan = actions.plan(parsed, $('bedrockPick').value);
      const mapping = { ...plan.mapping };
      for (const select of $('bedrockMapping').querySelectorAll('select[data-bone]'))
        if (select.value) mapping[select.dataset.bone] = select.value;
      const result = actions.apply(parsed, $('bedrockPick').value, mapping);
      status(['Đã nhập ' + result.bones + ' xương.', ...result.warnings].join('\n'));
      reset();
    } catch (error) {
      status(error.message);
    }
  });
  function run() {
    try {
      const result = actions.exportFile();
      status(['Đã xuất ' + result.filename + '.', ...result.warnings].join('\n'));
    } catch (error) {
      status(error.message);
    }
  }
  return {
    exportNow: run,
    openImport: () => $('bedrockImportInput').click(),
    sync(readOnly) {
      $('bedrockApply').disabled = $('bedrockImportInput').disabled = !!readOnly;
    },
  };
}
