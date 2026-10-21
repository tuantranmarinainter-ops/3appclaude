"""Fixed scenario contract tests; transport and geometry are browser-tested."""
import unittest

from .app3_mcp import validate
from .app3_mcp_demo import DESCRIPTION, operations


class FixedPromptTest(unittest.TestCase):
    def test_plan_matches_real_staged_tool_schema(self):
        pose = {"time": .75, "transforms": {"b42": {"p": [0, 1, 0], "q": [0, 0, 0, 1], "s": [1, 1, 1]}}}
        commands = operations({"description": DESCRIPTION, "duration": 4, "poses": [pose]})
        self.assertEqual([x[0] for x in commands], ["create_blocking", "set_pose"])
        self.assertEqual([m["time"] for m in commands[0][1]["markers"]], [0, .5, 3.5, 4])
        self.assertEqual(commands[1][1]["interpolation"], "linear")
        identity = dict.fromkeys(("sessionId", "epoch", "characterId", "serverInstance"), "11111111-1111-4111-8111-111111111111")
        for tool, parameters in commands:
            validate({"command": "app3.command.submit", "projectId": identity["sessionId"], "expectedRevision": 0,
                "args": {**identity, "tool": tool, "parameters": parameters, "expectedAnimationRevision": "native-0"}})

    def test_other_prompts_or_duration_are_not_claimed_supported(self):
        for plan in ({"description": "walk", "duration": 4}, {"description": DESCRIPTION, "duration": 5}):
            with self.assertRaises(ValueError):
                operations(plan)


if __name__ == "__main__":
    unittest.main()
