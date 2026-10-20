#!/usr/bin/env python3
"""Verify the dedicated 3D MCP contract and optional additive media round trip.
Credentials are read from a mode-0600 JSON file outside the repository and are
never included in evidence. Requires requests. --render explicitly enables writes
in the authorized account; it creates new review canvases and does not delete them.
"""
import argparse, hashlib, json, pathlib, requests

EXPECTED = {
    'list_topview_canvases': (True, False, False),
    'create_topview_canvas': (False, False, False),
    'prepare_topview_canvas_media_upload': (False, False, False),
    'get_topview_canvas_state': (True, False, False),
    'create_topview_canvas_media_node': (False, False, True),
    'get_topview_canvas_web_link': (True, False, False),
}
HINTS = ('readOnlyHint', 'destructiveHint', 'openWorldHint')


def data(message):
    assert not message.get('error'), 'RPC error: ' + str(message.get('error', {}).get('code'))
    result = message['result']
    assert not result.get('isError'), 'Tool reported an error'
    if 'structuredContent' in result:
        return result['structuredContent']
    if 'content' in result:
        return json.loads(next(x['text'] for x in result['content'] if x['type'] == 'text'))
    return result


class Client:
    def __init__(self, root, token, version, client):
        self.url = root.rstrip('/') + '/topview-browser/mcp'
        self.version, self.counter, self.sid = version, 0, None
        self.client = client
        self.headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json, text/event-stream',
                        'MCP-Protocol-Version': version, 'X-Topview-Plugin-Client': client,
                        'X-Topview-Plugin-Version': '0.1.8'}
        self.meta = {'io.modelcontextprotocol/protocolVersion': version,
                     'io.modelcontextprotocol/clientCapabilities': {},
                     'io.modelcontextprotocol/clientInfo': {'name': client, 'version': '3d-review'}}
        if version == '2026-07-28':
            discovery = data(self.rpc('server/discover', {}))
            assert version in discovery['supportedVersions']
            assert discovery['_meta']['io.modelcontextprotocol/serverInfo']['name'] == 'Topview 3D Builder'
            assert 'resources' not in discovery['capabilities']
            assert 'extensions' not in discovery['capabilities']
            return
        result = data(self.rpc('initialize', {'protocolVersion': version, 'capabilities': {},
                                             'clientInfo': {'name': client, 'version': '3d-review'}}))
        negotiated = result['protocolVersion']
        assert negotiated in ('2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'), 'Unsupported negotiated protocol'
        self.version = negotiated
        self.headers['MCP-Protocol-Version'] = negotiated
        self.meta['io.modelcontextprotocol/protocolVersion'] = negotiated
        if negotiated != '2026-07-28':
            response = requests.post(self.url, headers=self.headers,
                                     json={'jsonrpc': '2.0', 'method': 'notifications/initialized'}, timeout=30)
            assert response.status_code in (200, 202, 204)

    def rpc(self, method, params):
        self.counter += 1
        print(self.version, self.client, method, params.get('name', ''), flush=True)
        headers, params = dict(self.headers), dict(params)
        if self.version == '2026-07-28' and method != 'initialize':
            headers['MCP-Method'] = method
            params['_meta'] = self.meta
            if method == 'tools/call':
                headers['MCP-Name'] = params['name']
        response = requests.post(self.url, headers=headers,
                                 json={'jsonrpc': '2.0', 'id': self.counter, 'method': method, 'params': params}, timeout=90)
        if response.headers.get('mcp-session-id'):
            self.sid = response.headers['mcp-session-id']
            self.headers['Mcp-Session-Id'] = self.sid
        if response.headers.get('content-type', '').startswith('text/event-stream'):
            messages = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith('data:')]
            return next(x for x in messages if x.get('id') == self.counter)
        assert response.status_code in (200, 400, 404), 'HTTP ' + str(response.status_code)
        return response.json()

    def call(self, tool_name, **arguments):
        return data(self.rpc('tools/call', {'name': tool_name, 'arguments': arguments}))

    def close(self):
        if self.sid:
            requests.delete(self.url, headers=self.headers, timeout=30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--render', type=pathlib.Path)
    parser.add_argument('--resume', action='store_true', help='Reuse completed checks from the output file')
    args = parser.parse_args()
    credential = json.loads(args.credentials.read_text())
    root, token = credential['resource'], credential['access_token']
    assert root in ('https://mcp-3d-test.topview.ai', 'https://mcp-3d.topview.ai')
    rows = []
    if args.resume and args.output.exists():
        previous = json.loads(args.output.read_text())
        assert previous['endpoint'] == root
        rows = previous['checks']
        if args.render:
            digest = hashlib.sha256(args.render.read_bytes()).hexdigest()
            assert all(row.get('renderSha256') == digest for row in rows if row['client'] == 'portal')
    for version in ('2025-03-26', '2026-07-28'):
        for host in ('portal', 'codex', 'claude', 'cursor'):
            if any(row['protocol'] == version and row['client'] == host for row in rows):
                continue
            client = Client(root, token, version, host)
            try:
                tools = data(client.rpc('tools/list', {}))['tools']
                assert {x['name'] for x in tools} == set(EXPECTED) and len(tools) == 6
                for tool in tools:
                    annotations = tool['annotations']
                    assert all(type(annotations[k]) is bool for k in HINTS)
                    assert tuple(annotations[k] for k in HINTS) == EXPECTED[tool['name']]
                    assert not tool.get('_meta')
                for name in ('call_tool', 'get_tool_schema', 'delete_topview_canvas',
                             'submit_topview_canvas_generation_task', 'topview_generate_image',
                             'open_topview_canvas_test', 'use_tiktok_data'):
                    rejected = client.rpc('tools/call', {'name': name, 'arguments': {}})
                    error = rejected.get('error', {})
                    expected_code = -32602 if client.version == '2026-07-28' else -32003
                    assert error.get('code') == expected_code, name
                    assert error.get('message') == 'Tool is unavailable in Topview 3D Builder', name
                invalid = client.rpc('tools/call', {'name': 'prepare_topview_canvas_media_upload',
                        'arguments': {'canvasId': 'invalid-review-id', 'fileName': 'test.png', 'fileSize': -1}})
                if client.version == '2026-07-28':
                    result = invalid.get('result', {})
                    assert result.get('isError') is True
                    error_text = ' '.join(x.get('text', '') for x in result.get('content', []))
                    assert '/fileSize' in error_text and 'minimum' in error_text
                else:
                    assert invalid.get('error', {}).get('code') == -32602
                row = {'protocol': version, 'negotiatedProtocol': client.version, 'client': host, 'catalog': 'six tools with expected booleans',
                       'deniedTools': 7, 'invalidArguments': 'rejected',
                       'definitionsSha256': hashlib.sha256(json.dumps(tools, sort_keys=True).encode()).hexdigest()}
                if args.render and host == 'portal':
                    canvas = client.call('create_topview_canvas', name='3D Builder Review ' + version)
                    cid = canvas['canvasId']
                    upload = client.call('prepare_topview_canvas_media_upload', canvasId=cid,
                                         fileName=args.render.name, fileSize=args.render.stat().st_size)
                    with args.render.open('rb') as file:
                        uploaded = requests.put(upload['uploadUrl'], headers=upload['requiredHeaders'], data=file, timeout=90)
                    assert 200 <= uploaded.status_code < 300, 'Upload failed'
                    node = client.call('create_topview_canvas_media_node', canvasId=cid, mediaType='image',
                                       url=upload['objectKey'], mimeType=upload['mimeType'], title='Local 3D reference', x=0, y=0)
                    args.output.parent.mkdir(parents=True, exist_ok=True)
                    journal = args.output.with_suffix('.writes.json')
                    writes = json.loads(journal.read_text()) if journal.exists() else []
                    writes.append({'protocol': version, 'canvasId': cid, 'createdNodeIds': node.get('createdNodeIds', []), 'nodeId': node.get('nodeId')})
                    journal.write_text(json.dumps(writes, indent=2))
                    state = client.call('get_topview_canvas_state', canvasId=cid)
                    created_ids = set(node.get('createdNodeIds', []))
                    if node.get('nodeId'):
                        created_ids.add(node['nodeId'])
                    assert created_ids, 'Creation did not return a node ID'
                    matches = [n for n in state.get('nodes', []) if n.get('id') in created_ids]
                    assert len(matches) == len(created_ids), 'Created node missing from readback'
                    assert all(n.get('type') == 'image' and n.get('x') == 0 and n.get('y') == 0 for n in matches)
                    row['createdNodeIds'] = sorted(created_ids)
                    link = client.call('get_topview_canvas_web_link', canvasId=cid)
                    canvases = client.call('list_topview_canvases', limit=20)
                    assert cid in json.dumps(canvases), 'New Canvas missing from list'
                    row.update(canvasId=cid, mediaReadback=True, linkVerified=cid in json.dumps(link),
                               renderSha256=hashlib.sha256(args.render.read_bytes()).hexdigest())
                    assert row['linkVerified']
                rows.append(row)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps({'endpoint': root, 'checks': rows}, indent=2))
                print(version, host, 'PASS', flush=True)
            finally:
                client.close()


if __name__ == '__main__':
    main()
