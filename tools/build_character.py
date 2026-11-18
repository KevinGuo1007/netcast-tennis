"""用 Blender 后台模式生成球员模型:低多边形网格 + 骨架 + 蒙皮权重,导出为 GLB。

运行:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_character.py -- public/models/player.glb [预览图目录]

坐标(Blender):x 向右,y 向前(角色面朝 +y),z 向上;导出为 glTF 后角色面朝 -z。
材质只用名字区分部位,颜色在游戏里按球员配色替换。
"""

import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(argv[0])
PREVIEW_DIR = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)

COLORS = {
    "Skin": (0.91, 0.71, 0.55),
    "Shirt": (1.0, 1.0, 1.0),
    "Shorts": (0.29, 0.12, 0.69),
    "Shoes": (0.72, 0.9, 0.18),
    "Sock": (1.0, 1.0, 1.0),
    "Hair": (0.17, 0.1, 0.07),
    "Band": (0.72, 0.9, 0.18),
    "Racket": (0.72, 0.9, 0.18),
    "Grip": (0.1, 0.06, 0.19),
    "Strings": (1.0, 1.0, 1.0),
}
MAT_NAMES = list(COLORS)
materials = []
for name in MAT_NAMES:
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*COLORS[name], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    m.diffuse_color = (*COLORS[name], 1.0)
    materials.append(m)

verts = []  # (x, y, z)
weights = []  # {bone: weight}
faces = []  # (indices, material index)


def add_vert(p, w):
    verts.append(p)
    weights.append(w)
    return len(verts) - 1


def tube(rings, sides, mat, cap_start=True, cap_end=True, seg_mats=None):
    """沿 z 轴的管状体。ring = (中心, (rx, ry), 权重)。相邻的环之间连成四边形。"""
    idx = []
    for center, (rx, ry), w in rings:
        ring = []
        for i in range(sides):
            a = 2 * math.pi * (i + 0.5) / sides
            ring.append(add_vert((center[0] + rx * math.cos(a), center[1] + ry * math.sin(a), center[2]), w))
        idx.append(ring)
    for r in range(len(idx) - 1):
        m = MAT_NAMES.index(seg_mats[r] if seg_mats else mat)
        for i in range(sides):
            j = (i + 1) % sides
            faces.append(((idx[r][i], idx[r][j], idx[r + 1][j], idx[r + 1][i]), m))
    m = MAT_NAMES.index(seg_mats[0] if seg_mats else mat)
    if cap_start:
        faces.append((tuple(reversed(idx[0])), m))
    m = MAT_NAMES.index(seg_mats[-1] if seg_mats else mat)
    if cap_end:
        faces.append((tuple(idx[-1]), m))


def box(center, size, mat, w):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    ids = [
        add_vert((cx + dx * sx, cy + dy * sy, cz + dz * sz), w)
        for dz in (-1, 1)
        for dy in (-1, 1)
        for dx in (-1, 1)
    ]
    m = MAT_NAMES.index(mat)
    for quad in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        faces.append((tuple(ids[i] for i in quad), m))


# ---------------------------------------------------------------- 躯干和头
tube(
    [
        ((0, 0, 0.80), (0.150, 0.110), {"Hips": 1}),
        ((0, 0, 0.90), (0.178, 0.122), {"Hips": 1}),
        ((0, 0, 0.99), (0.168, 0.116), {"Hips": 0.6, "Spine": 0.4}),
    ],
    8,
    "Shorts",
)
tube(
    [
        ((0, 0, 0.97), (0.172, 0.120), {"Hips": 0.5, "Spine": 0.5}),
        ((0, 0, 1.15), (0.166, 0.115), {"Spine": 1}),
        ((0, 0, 1.34), (0.214, 0.136), {"Spine": 1}),
        ((0, 0, 1.45), (0.212, 0.124), {"Spine": 1}),
        ((0, 0, 1.475), (0.110, 0.085), {"Spine": 1}),
    ],
    8,
    "Shirt",
)
tube(
    [
        ((0, 0, 1.44), (0.056, 0.056), {"Spine": 1}),
        ((0, 0, 1.53), (0.056, 0.056), {"Head": 1}),
    ],
    6,
    "Skin",
)
H = {"Head": 1}
tube(
    [
        ((0, 0.005, 1.505), (0.080, 0.085), H),
        ((0, 0.005, 1.56), (0.152, 0.150), H),
        ((0, 0.005, 1.67), (0.172, 0.170), H),
        ((0, 0.005, 1.78), (0.156, 0.158), H),
        ((0, 0.005, 1.84), (0.092, 0.096), H),
    ],
    8,
    "Skin",
)
# 头发:头顶的帽状 + 后脑勺
tube(
    [
        ((0, -0.006, 1.745), (0.181, 0.182), H),
        ((0, -0.006, 1.812), (0.164, 0.168), H),
        ((0, -0.006, 1.872), (0.096, 0.102), H),
    ],
    8,
    "Hair",
)
box((0, -0.125, 1.68), (0.30, 0.11, 0.19), "Hair", H)
tube(
    [
        ((0, 0.002, 1.712), (0.186, 0.185), H),
        ((0, 0.002, 1.752), (0.186, 0.185), H),
    ],
    8,
    "Band",
)
for s in (-1, 1):  # 眼睛
    box((s * 0.064, 0.168, 1.655), (0.038, 0.02, 0.05), "Hair", H)

# ---------------------------------------------------------------- 手臂
for s, suf in ((1, "R"), (-1, "L")):
    x = s * 0.262
    upper, lower = "UpperArm" + suf, "LowerArm" + suf
    tube(
        [
            ((x, 0, 1.462), (0.080, 0.082), {upper: 1}),
            ((x, 0, 1.290), (0.074, 0.076), {upper: 1}),
        ],
        6,
        "Shirt",
    )
    tube(
        [
            ((x, 0, 1.31), (0.060, 0.060), {upper: 1}),
            ((x, 0, 1.15), (0.055, 0.055), {upper: 0.5, lower: 0.5}),
            ((x, 0, 0.90), (0.047, 0.047), {lower: 1}),
        ],
        6,
        "Skin",
    )
    hand = {"HandR": 1} if suf == "R" else {lower: 1}
    box((x, 0, 0.852), (0.09, 0.10, 0.115), "Skin", hand)

# ---------------------------------------------------------------- 腿
for s, suf in ((1, "R"), (-1, "L")):
    x = s * 0.095
    thigh, shin = "Thigh" + suf, "Shin" + suf
    tube(
        [
            ((x, 0, 0.87), (0.096, 0.100), {thigh: 1}),
            ((x, 0, 0.70), (0.092, 0.094), {thigh: 1}),
        ],
        6,
        "Shorts",
    )
    tube(
        [
            ((x, 0, 0.72), (0.084, 0.086), {thigh: 1}),
            ((x, 0, 0.50), (0.072, 0.074), {thigh: 0.5, shin: 0.5}),
            ((x, 0, 0.22), (0.060, 0.062), {shin: 1}),
        ],
        6,
        "Skin",
    )
    tube(
        [
            ((x, 0, 0.235), (0.066, 0.068), {shin: 1}),
            ((x, 0, 0.095), (0.064, 0.066), {shin: 1}),
        ],
        6,
        "Sock",
    )
    box((x, 0.055, 0.055), (0.118, 0.285, 0.10), "Shoes", {shin: 1})
    box((x, 0.055, 0.012), (0.126, 0.295, 0.024), "Sock", {shin: 1})  # 鞋底

# ---------------------------------------------------------------- 球拍(握在右手,自然下垂)
RX = 0.262
HW = {"HandR": 1}
tube([((RX, 0, 0.87), (0.021, 0.021), HW), ((RX, 0, 0.65), (0.019, 0.019), HW)], 6, "Grip")
tube([((RX, 0, 0.65), (0.015, 0.015), HW), ((RX, 0, 0.50), (0.015, 0.015), HW)], 6, "Racket", cap_start=False)
# 拍框:椭圆环,截面是小方形
SEG = 12
CZ, RAD_X, RAD_Z, T = 0.345, 0.128, 0.168, 0.014
frame = []
for i in range(SEG):
    a = 2 * math.pi * i / SEG
    ca, sa = math.cos(a), math.sin(a)
    ring = []
    for dr, dy in ((-T, -T), (T, -T), (T, T), (-T, T)):
        ring.append(add_vert((RX + (RAD_X + dr) * ca, dy, CZ + (RAD_Z + dr) * sa), HW))
    frame.append(ring)
RM = MAT_NAMES.index("Racket")
for i in range(SEG):
    a, b = frame[i], frame[(i + 1) % SEG]
    for k in range(4):
        n = (k + 1) % 4
        faces.append(((a[k], a[n], b[n], b[k]), RM))
# 拍线:一片半透明的面
strings = [
    add_vert((RX + (RAD_X - T) * math.cos(2 * math.pi * i / SEG), 0, CZ + (RAD_Z - T) * math.sin(2 * math.pi * i / SEG)), HW)
    for i in range(SEG)
]
faces.append((tuple(strings), MAT_NAMES.index("Strings")))

# ---------------------------------------------------------------- 生成网格
mesh = bpy.data.meshes.new("Player")
mesh.from_pydata(verts, [], [f[0] for f in faces])
for m in materials:
    mesh.materials.append(m)
for poly, (_, mat_index) in zip(mesh.polygons, faces):
    poly.material_index = mat_index
    poly.use_smooth = False
mesh.update()
body = bpy.data.objects.new("Player", mesh)
bpy.context.scene.collection.objects.link(body)

# 统一法线朝外
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- 骨架
BONES = [
    ("Hips", (0, 0, 0.92), None),
    ("Spine", (0, 0, 0.97), "Hips"),
    ("Head", (0, 0, 1.49), "Spine"),
    ("UpperArmR", (0.25, 0, 1.42), "Spine"),
    ("LowerArmR", (0.262, 0, 1.15), "UpperArmR"),
    ("HandR", (0.262, 0, 0.90), "LowerArmR"),
    ("UpperArmL", (-0.25, 0, 1.42), "Spine"),
    ("LowerArmL", (-0.262, 0, 1.15), "UpperArmL"),
    ("ThighR", (0.095, 0, 0.88), "Hips"),
    ("ShinR", (0.095, 0, 0.50), "ThighR"),
    ("ThighL", (-0.095, 0, 0.88), "Hips"),
    ("ShinL", (-0.095, 0, 0.50), "ThighL"),
]
arm_data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, head, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head = head
    b.tail = (head[0], head[1], head[2] + 0.1)  # 骨骼统一朝上;只有关节位置对蒙皮有影响
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

# 蒙皮权重
groups = {name: body.vertex_groups.new(name=name) for name, _, _ in BONES}
for i, w in enumerate(weights):
    for bone, value in w.items():
        groups[bone].add([i], value, "REPLACE")
body.parent = rig
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = rig

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_skins=True,
    export_animations=False,
    export_apply=False,
)
print("EXPORTED", OUT, "verts", len(verts), "faces", len(faces))

# ---------------------------------------------------------------- 预览图(可选)
if PREVIEW_DIR:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 500
    scene.render.resolution_y = 700
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    scene.world = world
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.2
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # 摆一个挥拍姿势,顺便检查骨骼和权重
    for label, pose in (("rest", {}), ("pose", {"UpperArmR": (1.2, 0, 0.6), "LowerArmR": (0.6, 0, 0), "ThighL": (0.6, 0, 0), "ShinL": (-0.8, 0, 0), "Spine": (0, 0, 0.5)})):
        for pb in rig.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = pose.get(pb.name, (0, 0, 0))
        for view, loc, rot in (
            ("front", (0, 4, 0.95), (math.pi / 2, 0, math.pi)),
            ("side", (4, 0, 0.95), (math.pi / 2, 0, math.pi / 2)),
            ("back34", (-2.6, -3.0, 2.2), (math.radians(68), 0, math.radians(-41))),
        ):
            cam.location = loc
            cam.rotation_euler = rot
            scene.render.filepath = os.path.join(PREVIEW_DIR, f"{label}_{view}.png")
            bpy.ops.render.render(write_still=True)
