"""Generate the UI catalogue from the approved docs; --check detects stale output."""
import argparse
import json
from pathlib import Path

import yaml


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[5]
    docs = root / 'docs/three-workspace-app/docs'
    modules = yaml.safe_load((docs / 'inventory/development.yaml').read_text(encoding='utf-8'))['modules']
    architecture = yaml.safe_load((docs / 'ARCHITECTURE.yaml').read_text(encoding='utf-8'))['tree']
    groups = [node for node in architecture if node['parent_id'] == '1']
    groups.append({'id': '2', 'name': 'Chẩn đoán · Diagnostics'})
    nodes = []
    workspaces = {'1.3': 'retarget', '1.4': 'scene', '1.5': 'animation'}
    for group in groups:
        nodes.append(dict(id=group['id'], parentId=None, label=group['name'], keywords=[],
                          workspace=workspaces.get(group['id'], 'shared'), requires=[]))
        for module in modules:
            if module['parent_id'] != group['id']:
                continue
            ui = module['ui']
            nodes.append(dict(id=module['id'], parentId=module['parent_id'], label=ui['label'],
                              keywords=ui['keywords'], workspace=ui['workspace'], panelId=ui['panel_id'],
                              requires=ui['requires'], spec=module['spec']))
    if len(nodes) != len(groups) + len(modules):
        raise ValueError('Unmapped feature parent in development.yaml')
    content = json.dumps(nodes, ensure_ascii=False, indent=2) + '\n'
    output = Path(__file__).resolve().parents[1] / 'src/featureManifest.json'
    if args.check:
        if not output.exists() or output.read_text(encoding='utf-8') != content:
            raise SystemExit('Feature manifest is stale. Run scripts/sync-feature-navigation.py.')
        print(f'Feature manifest matches docs: {len(groups)} groups, {len(modules)} leaves.')
    else:
        output.write_text(content, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
