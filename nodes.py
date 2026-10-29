"""Virtual named-reroute nodes for ComfyUI.

The frontend extension rewrites the temporary execution graph before queueing.
These Python implementations are intentionally lightweight fallbacks so the
node classes are registered and workflows can be loaded even if the frontend
extension is unavailable. Normal execution should remove these virtual nodes
from the API prompt before the backend sees them.
"""


class NamedRerouteSet:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "name": ("STRING", {"default": "my_data", "multiline": False}),
                "value": ("*",),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = "utils/命名重定向"
    DESCRIPTION = "定义一个全局名称，并把输入数据提供给同名的使用节点。此节点为虚拟节点。"

    def execute(self, name, value):
        # Virtual node. It should be removed by the frontend before execution.
        return ()


class NamedRerouteGet:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "name": ("STRING", {"default": "my_data", "multiline": False}),
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("value",)
    FUNCTION = "execute"
    CATEGORY = "utils/命名重定向"
    DESCRIPTION = "读取同名定义节点的数据。一个名称可以有多个使用节点。此节点为虚拟节点。"

    def execute(self, name):
        # This fallback is not the normal execution path. The frontend should
        # resolve the named link and remove this node before queueing.
        raise RuntimeError(
            f"Named Reroute frontend did not resolve '{name}'. "
            "Please refresh ComfyUI and confirm the extension loaded."
        )


NODE_CLASS_MAPPINGS = {
    "NamedRerouteSet": NamedRerouteSet,
    "NamedRerouteGet": NamedRerouteGet,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NamedRerouteSet": "命名重定向 · 定义",
    "NamedRerouteGet": "命名重定向 · 使用",
}
