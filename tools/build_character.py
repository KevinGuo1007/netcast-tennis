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
    "Trim": (0.72, 0.9, 0.18),
    "Shorts": (0.29, 0.12, 0.69),
    "Shoes": (0.72, 0.9, 0.18),
    "Sock": (1.0, 1.0, 1.0),
    "Hair": (0.17, 0.1, 0.07),
    "Eye": (0.1, 0.06, 0.19),
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
faces = []  # (indices, material index, smooth)


def add_vert(p, w):
    verts.append(p)
    weights.append(w)
    return len(verts) - 1


def face(ids, mat, smooth=False):
    faces.append((tuple(ids), MAT_NAMES.index(mat), smooth))


def tube(rings, sides, mat, cap_start=True, cap_end=True, seg_mats=None):
    """沿 z 轴的管状体。ring = (中心, (rx, ry), 权重)。相邻的环之间连成四边形,侧面平滑着色。

    换材质的地方(seg_mats 里相邻两段不同)会把那一圈顶点拆开,颜色的分界才是一条干净的线。
    """
    def make_ring(center, radius, w):
        rx, ry = radius
        return [
            add_vert((center[0] + rx * math.cos(a), center[1] + ry * math.sin(a), center[2]), w)
            for a in (2 * math.pi * (i + 0.5) / sides for i in range(sides))
        ]

    mats = seg_mats or [mat] * (len(rings) - 1)
    lower = make_ring(*rings[0])
    first = lower
    for r in range(len(rings) - 1):
        upper = make_ring(*rings[r + 1])
        for i in range(sides):
            j = (i + 1) % sides
            face((lower[i], lower[j], upper[j], upper[i]), mats[r], smooth=True)
        last = upper
        # 下一段换材质:重新生成一圈顶点,避免两种颜色共用法线
        lower = make_ring(*rings[r + 1]) if r + 1 < len(mats) and mats[r + 1] != mats[r] else upper
    if cap_start:
        face(reversed(first), mats[0])
    if cap_end:
        face(last, mats[-1])


def box(center, size, mat, w):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    ids = [
        add_vert((cx + dx * sx, cy + dy * sy, cz + dz * sz), w)
        for dz in (-1, 1)
        for dy in (-1, 1)
        for dx in (-1, 1)
    ]
    for quad in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        face((ids[i] for i in quad), mat)


def extrude_x(profile, x0, x1, mat, w):
    """把侧面轮廓(一圈 (y, z) 点)沿 x 方向拉成柱体。"""
    a = [add_vert((x0, y, z), w) for y, z in profile]
    b = [add_vert((x1, y, z), w) for y, z in profile]
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        face((a[i], a[j], b[j], b[i]), mat)
    face(reversed(a), mat)
    face(b, mat)


def bar(p0, p1, t, mat, w):
    """xz 平面里从 p0 到 p1 的一根方条,截面边长 2t。"""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    nx, nz = -dz / length * t, dx / length * t
    ends = []
    for x, z in (p0, p1):
        ends.append([add_vert((x + sx * nx, sy * t, z + sx * nz), w) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for k in range(4):
        n = (k + 1) % 4
        face((ends[0][k], ends[0][n], ends[1][n], ends[1][k]), mat)
    face(reversed(ends[0]), mat)
    face(ends[1], mat)


# ---------------------------------------------------------------- 躯干
# 短裤的裆部
tube(
    [
        ((0, 0, 0.775), (0.150, 0.112), {"Hips": 1}),
        ((0, 0, 0.88), (0.186, 0.130), {"Hips": 1}),
        ((0, 0, 0.99), (0.176, 0.122), {"Hips": 0.6, "Spine": 0.4}),
    ],
    10,
    "Shorts",
)
# 上衣:下摆略宽盖住裤腰,收腰,胸和肩最宽;胸口一道饰条
tube(
    [
        ((0, 0, 0.955), (0.187, 0.132), {"Hips": 0.5, "Spine": 0.5}),
        ((0, 0, 1.08), (0.170, 0.118), {"Spine": 1}),
        ((0, 0.004, 1.265), (0.204, 0.136), {"Spine": 1}),
        ((0, 0.004, 1.335), (0.220, 0.142), {"Spine": 1}),
        ((0, 0, 1.44), (0.218, 0.128), {"Spine": 1}),
        ((0, 0, 1.488), (0.104, 0.086), {"Spine": 1}),
    ],
    10,
    "Shirt",
    seg_mats=["Shirt", "Shirt", "Trim", "Shirt", "Shirt"],
)
# 领口
tube(
    [
        ((0, 0.004, 1.470), (0.086, 0.080), {"Spine": 1}),
        ((0, 0.004, 1.502), (0.076, 0.072), {"Spine": 1}),
    ],
    8,
    "Trim",
)
# 脖子
tube(
    [
        ((0, 0, 1.45), (0.058, 0.058), {"Spine": 1}),
        ((0, 0, 1.55), (0.060, 0.060), {"Head": 1}),
    ],
    8,
    "Skin",
)

# ---------------------------------------------------------------- 头
H = {"Head": 1}
tube(
    [
        ((0, 0.012, 1.500), (0.066, 0.072), H),
        ((0, 0.008, 1.540), (0.132, 0.136), H),
        ((0, 0.005, 1.615), (0.168, 0.164), H),
        ((0, 0.005, 1.700), (0.176, 0.172), H),
        ((0, 0.005, 1.780), (0.164, 0.164), H),
        ((0, 0.005, 1.846), (0.106, 0.110), H),
    ],
    10,
    "Skin",
)
# 头发:从后颈往上包住后脑勺,到头带以上盖住整个头顶;两侧从耳后斜着收到鬓角
tube(
    [
        ((0, -0.078, 1.555), (0.130, 0.082), H),
        ((0, -0.062, 1.640), (0.178, 0.126), H),
        ((0, -0.010, 1.742), (0.187, 0.188), H),
        ((0, -0.012, 1.810), (0.178, 0.182), H),
        ((0, -0.016, 1.872), (0.132, 0.140), H),
        ((0, -0.020, 1.902), (0.062, 0.070), H),
    ],
    10,
    "Hair",
)
for s in (-1, 1):
    box((s * 0.180, 0.012, 1.640), (0.032, 0.052, 0.07), "Skin", H)  # 耳朵
    box((s * 0.066, 0.166, 1.660), (0.042, 0.024, 0.054), "Eye", H)  # 眼睛
box((0, 0.176, 1.618), (0.036, 0.034, 0.042), "Skin", H)  # 鼻子
# 头带
tube(
    [
        ((0, 0.000, 1.708), (0.191, 0.190), H),
        ((0, 0.000, 1.752), (0.191, 0.190), H),
    ],
    10,
    "Band",
)

# ---------------------------------------------------------------- 手臂
for s, suf in ((1, "R"), (-1, "L")):
    x = s * 0.262
    upper, lower = "UpperArm" + suf, "LowerArm" + suf
    # 袖子:肩头收圆,袖口一圈饰条
    tube(
        [
            ((x - s * 0.020, 0, 1.494), (0.026, 0.030), {upper: 1}),
            ((x - s * 0.012, 0, 1.482), (0.058, 0.062), {upper: 1}),
            ((x - s * 0.004, 0, 1.455), (0.077, 0.081), {upper: 1}),
            ((x, 0, 1.410), (0.081, 0.085), {upper: 1}),
            ((x, 0, 1.310), (0.079, 0.082), {upper: 1}),
            ((x, 0, 1.275), (0.081, 0.084), {upper: 1}),
        ],
        8,
        "Shirt",
        seg_mats=["Shirt", "Shirt", "Shirt", "Shirt", "Trim"],
    )
    tube(
        [
            ((x, 0, 1.290), (0.062, 0.064), {upper: 1}),
            ((x, 0, 1.180), (0.056, 0.058), {upper: 0.8, lower: 0.2}),
            ((x, 0, 1.150), (0.057, 0.058), {upper: 0.5, lower: 0.5}),
            ((x, 0, 1.105), (0.063, 0.064), {upper: 0.1, lower: 0.9}),
            ((x, 0, 0.940), (0.046, 0.047), {lower: 1}),
        ],
        8,
        "Skin",
    )
    # 护腕
    tube(
        [
            ((x, 0, 0.972), (0.055, 0.056), {lower: 1}),
            ((x, 0, 0.926), (0.053, 0.054), {lower: 1}),
        ],
        8,
        "Band",
    )
    hand = {"HandR": 1} if suf == "R" else {lower: 1}
    box((x, 0.004, 0.858), (0.094, 0.108, 0.128), "Skin", hand)

# ---------------------------------------------------------------- 腿和脚
for s, suf in ((1, "R"), (-1, "L")):
    x = s * 0.095
    thigh, shin, foot = "Thigh" + suf, "Shin" + suf, "Foot" + suf
    # 裤腿:下摆略微张开,带一圈饰条
    tube(
        [
            ((x, 0, 0.895), (0.100, 0.106), {thigh: 1}),
            ((x, 0, 0.705), (0.104, 0.108), {thigh: 1}),
            ((x, 0, 0.670), (0.105, 0.109), {thigh: 1}),
        ],
        8,
        "Shorts",
        seg_mats=["Shorts", "Trim"],
    )
    # 大腿 → 膝盖 → 小腿肚 → 脚踝
    tube(
        [
            ((x, 0, 0.700), (0.090, 0.094), {thigh: 1}),
            ((x, 0, 0.545), (0.078, 0.082), {thigh: 0.85, shin: 0.15}),
            ((x, 0.004, 0.500), (0.075, 0.080), {thigh: 0.5, shin: 0.5}),
            ((x, 0, 0.455), (0.072, 0.076), {thigh: 0.1, shin: 0.9}),
            ((x, -0.012, 0.375), (0.077, 0.085), {shin: 1}),
            ((x, 0, 0.225), (0.055, 0.057), {shin: 1}),
        ],
        8,
        "Skin",
    )
    tube(
        [
            ((x, 0, 0.255), (0.060, 0.062), {shin: 1}),
            ((x, 0, 0.115), (0.058, 0.060), {shin: 0.6, foot: 0.4}),
        ],
        8,
        "Sock",
    )
    # 鞋:鞋帮后高前低,鞋底是白色的一层
    F = {foot: 1}
    extrude_x(
        [(-0.105, 0.030), (0.215, 0.030), (0.215, 0.072), (0.125, 0.104), (0.040, 0.138), (-0.105, 0.138)],
        x - 0.064,
        x + 0.064,
        "Shoes",
        F,
    )
    box((x, 0.057, 0.015), (0.140, 0.336, 0.030), "Sock", F)

# ---------------------------------------------------------------- 球拍(握在右手,自然下垂)
RX = 0.262
HW = {"HandR": 1}
tube([((RX, 0, 0.895), (0.027, 0.027), HW), ((RX, 0, 0.880), (0.027, 0.027), HW)], 6, "Racket")  # 拍柄底盖
tube([((RX, 0, 0.880), (0.022, 0.022), HW), ((RX, 0, 0.650), (0.020, 0.020), HW)], 6, "Grip")
tube([((RX, 0, 0.650), (0.016, 0.016), HW), ((RX, 0, 0.585), (0.016, 0.016), HW)], 6, "Racket", cap_start=False)
# 拍框:椭圆环,截面是小方形
SEG = 14
CZ, RAD_X, RAD_Z, T = 0.330, 0.135, 0.176, 0.018
frame = []
for i in range(SEG):
    a = 2 * math.pi * i / SEG
    ca, sa = math.cos(a), math.sin(a)
    ring = []
    for dr, dy in ((-T, -T), (T, -T), (T, T), (-T, T)):
        ring.append(add_vert((RX + (RAD_X + dr) * ca, dy, CZ + (RAD_Z + dr) * sa), HW))
    frame.append(ring)
for i in range(SEG):
    a, b = frame[i], frame[(i + 1) % SEG]
    for k in range(4):
        n = (k + 1) % 4
        face((a[k], a[n], b[n], b[k]), "Racket")
# 拍喉:从拍杆分出两根,接到拍框上
for s in (-1, 1):
    ang = math.radians(90 + s * 36)
    bar((RX + s * 0.008, 0.592), (RX + RAD_X * math.cos(ang), CZ + RAD_Z * math.sin(ang)), 0.013, "Racket", HW)
# 拍线:一片半透明的面
strings = [
    add_vert((RX + (RAD_X - T) * math.cos(2 * math.pi * i / SEG), 0, CZ + (RAD_Z - T) * math.sin(2 * math.pi * i / SEG)), HW)
    for i in range(SEG)
]
face(strings, "Strings")

# ---------------------------------------------------------------- 生成网格
mesh = bpy.data.meshes.new("Player")
mesh.from_pydata(verts, [], [f[0] for f in faces])
for m in materials:
    mesh.materials.append(m)
for poly, (_, mat_index, smooth) in zip(mesh.polygons, faces):
    poly.material_index = mat_index
    poly.use_smooth = smooth
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
    ("FootR", (0.095, 0, 0.09), "ShinR"),
    ("ThighL", (-0.095, 0, 0.88), "Hips"),
    ("ShinL", (-0.095, 0, 0.50), "ThighL"),
    ("FootL", (-0.095, 0, 0.09), "ShinL"),
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
