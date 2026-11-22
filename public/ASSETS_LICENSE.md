# Local 3D, HDRI, and PBR Asset Licenses

All assets stored in `public/` are loaded strictly from local files at runtime (zero external network fetches). Every asset is redistributed under its original permissive open-source or public-domain license.

## 3D Models

| Local Path | Asset | License | Source |
| --- | --- | --- | --- |
| `public/models/ferrari.glb` | Ferrari 458 Italia (`ferrari.glb`) | MIT | Three.js Official Examples (`https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/ferrari.glb`) |
| `public/models/character.glb` | Rigged Human Character (`Soldier.glb`) | MIT | Three.js Official Examples (`https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb`) |

## HDRI Environment Skybox

| Local Path | Asset | License | Source |
| --- | --- | --- | --- |
| `public/hdri/evening_road_01_puresky_1k.hdr` | Evening Road 01 Pure Sky (1K HDRI) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/evening_road_01_puresky`) |

## 1K Photographic PBR Texture Sets

Each directory contains `diff.jpg` (Diffuse/Albedo), `nor_gl.jpg` (OpenGL Normal), and `rough.jpg` (Roughness or ARM packed with Roughness in the Green channel, natively sampled by Three.js `roughnessMap`).

| Local Directory | Asset | License | Source |
| --- | --- | --- | --- |
| `public/textures/asphalt/` | Asphalt 02 (`asphalt_02`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/asphalt_02`) |
| `public/textures/sidewalk/` | Concrete Pavement (`concrete_pavement`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/concrete_pavement`) |
| `public/textures/terrain/` | Aerial Grass Rock (`aerial_grass_rock`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/aerial_grass_rock`) |
| `public/textures/plaster/` | Painted Plaster Wall (`painted_plaster_wall`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/painted_plaster_wall`) |
| `public/textures/roof/` | Clay Roof Tiles (`clay_roof_tiles`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/clay_roof_tiles`) |
| `public/textures/facade/` | Brick Wall 001 (`brick_wall_001`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/brick_wall_001`) |
| `public/textures/palm_bark/` | Island Tree 01 Bark (`island_tree_01`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/island_tree_01`) |
| `public/textures/palm_leaves/` | Island Tree 01 Fronds (`island_tree_01`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/island_tree_01`) |
| `public/textures/jacaranda_bark/` | Jacaranda Tree Bark (`jacaranda_tree`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/jacaranda_tree`) |
| `public/textures/jacaranda_leaves/` | Jacaranda Tree Canopy (`jacaranda_tree`, 1K) | CC0 1.0 | Poly Haven (`https://polyhaven.com/a/jacaranda_tree`) |

## Compression Decoders

| Local Directory | Asset | License | Source |
| --- | --- | --- | --- |
| `public/draco/draco_decoder.js` | Draco glTF JS Decoder | Apache-2.0 / MIT | Copied locally from `three` (`node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js`) |
