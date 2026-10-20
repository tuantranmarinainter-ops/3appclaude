# Topview 3D Builder review remediation

The dedicated `mcp-3d.topview.ai` endpoint delivers locally rendered 3D media into the authenticated user's Canvas. It does not expose the general Topview generation, editing, deletion, data-discovery or generic executor catalog. The same exact allowlist is enforced by `tools/list` and `tools/call` in both protocol eras, including rejection of aliases and direct calls to omitted tools.

## Explicit annotations and behavioral justification

All three fields below are serialized as JSON booleans; none are omitted or null.

| Tool | readOnlyHint | destructiveHint | openWorldHint | Actual behavior and justification |
| --- | --- | --- | --- | --- |
| list_topview_canvases | true | false | false | Reads accessible Canvas summaries in the authenticated private workspace. Does not change content or contact arbitrary destinations. |
| create_topview_canvas | false | false | false | Persists a new private Canvas. Additive: does not replace/delete existing projects. Only writes to the authorized Topview workspace. No generation is submitted. |
| prepare_topview_canvas_media_upload | false | false | false | Issues a temporary upload authorization for a new object in Topview-managed storage. The client performs the PUT separately. Does not change Canvas revision or overwrite nodes; caller cannot choose an arbitrary upload destination. |
| get_topview_canvas_state | true | false | false | Reads sanitized state from the specified authorized Canvas. Does not modify content, submit jobs or fetch referenced external URLs. |
| create_topview_canvas_media_node | false | false | true | Persists a new media reference node, without replacing/deleting existing nodes. Accepts caller-provided durable HTTPS media/poster/thumbnail references, which can point to arbitrary external resources. No generation is submitted. |
| get_topview_canvas_web_link | true | false | false | Checks access with the existing Canvas metadata read and derives the Topview browser URL. Does not mint a sharing ticket, change permissions or contact an arbitrary destination. |

The descriptions returned by the MCP endpoint include these behavioral explanations. Input and output schemas remain the existing validated Canvas contracts. Authentication, workspace access checks, schema validation and downstream authorization remain required.

## Scope and routing

The profile applies only to configured 3D public hosts and the aggregate gateway. Host resolution uses the existing OAuth public-host configuration. Ordinary browser/embed endpoints and unrelated gateway IDs retain their catalogs. Legacy sessions cannot be reused across interaction profiles. No iframe UI metadata is advertised by the 3D catalog. Modern discovery omits unrelated UI and task extensions.

## Regression validation

The regression suite covers the exact six-tool catalog and boolean annotation values across Legacy and Modern requests; direct rejection of excluded tools and aliases before dispatch; allowed reads/writes; invalid upload arguments; ACL verification before returning links; host/gateway/session isolation; and ordinary endpoint behavior. Redis-backed integration tests run through Testcontainers.

One pre-existing test fixture expected the opt-in creator-discovery domain while using defaults that exclude it. The fixture now explicitly enables all domains it intends to test. Production defaults are unchanged; the failure was independently reproduced on unmodified main.

## Live acceptance gate before resubmission

1. Deploy a test integration revision preserving the current test branch.
2. Verify real OAuth discovery, initialization and exactly six tools on the dedicated 3D host.
3. Use a dedicated test account to create a new Canvas, prepare and PUT a local render, add a media node, read it back and obtain its authorized link. Confirm no generation is needed.
4. Verify excluded operations and invalid arguments fail without side effects; compare the ordinary endpoint catalog.
5. Deploy the reviewed main-based patch to production and repeat the applicable checks.
6. Refresh Portal tool discovery and run the review cases before submitting. Pipeline success alone is not product acceptance.

## Reviewer response draft

We narrowed Topview 3D Builder's dedicated MCP server to six independently exposed tools for delivering locally rendered media into Canvas. Unrelated generation, deletion, data-discovery and generic execution tools are no longer listed or callable on this endpoint. Every retained tool explicitly sets readOnlyHint, destructiveHint and openWorldHint to true or false, with a behavior-based explanation in its description. In particular, create_topview_canvas_media_node has openWorldHint=true because its media/poster/thumbnail references may point to arbitrary external HTTPS resources. The three write tools have readOnlyHint=false; the additive write tools do not overwrite or delete existing content. The attached annotation table documents all six decisions.

References: https://developers.openai.com/plugins/plugin-guidelines#correct-annotation and https://developers.openai.com/plugins/deploy/submission-errors#mcp-and-review-errors .
