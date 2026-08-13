# Asset provenance

Every third-party byte shipped by Parkworks Tycoon must be public domain/CC0
or have a separately documented permissive license. Source-visible is not the
same as reusable; unlicensed GitHub assets do not enter this repository.

## Texture sets

The texture files below are authored by ambientCG and released under
[CC0 1.0](https://ambientcg.com/license). They were retrieved from ambientCG's
official 1K-JPG archives on 2026-08-12, then resized and converted locally to
WebP. Color maps are at most 1024 px (quality 82); normal, roughness, and AO maps
are at most 512 px (quality 78–85). The source archives are not redistributed.

| Asset ID | Use | Source | Physical tile | Local files |
|---|---|---|---:|---|
| Grass005 | Mown park lawn | [ambientCG](https://ambientcg.com/view?id=Grass005) | 2 × 2 m estimate | color, NormalGL, roughness, AO |
| Concrete034 | Broomed concrete slabs and pads | [ambientCG](https://ambientcg.com/view?id=Concrete034) | 1.1 × 0.55 m published | color, NormalGL, roughness |
| PavingStones138 | Main paths and entrance plaza | [ambientCG](https://ambientcg.com/view?id=PavingStones138) | 1.25 × 2.5 m published | color, NormalGL, roughness, AO |
| Bark014 | Mature tree trunks | [ambientCG](https://ambientcg.com/view?id=Bark014) | 1.2 × 1.2 m published | color, NormalGL, roughness, AO |
| Planks037A | Benches, counters, and timber trim | [ambientCG](https://ambientcg.com/view?id=Planks037A) | 2 × 2 m estimate | color, NormalGL, roughness, AO |

The authoritative ambientCG API endpoints used by the importer are documented
at <https://docs.ambientcg.com/api/v2/full_json/>. Re-run
`tools/import-ambientcg.ps1` to reproduce the local derivatives.
Exact output checksums are recorded in
[`public/assets/textures/manifest.sha256`](public/assets/textures/manifest.sha256).

## Code-created content

All procedural geometry, decals, interface artwork, icons, generated noise
maps, and game code authored in this repository are released with the project
under CC0 1.0. Three.js is an npm runtime dependency under the MIT License and
is not copied into source control.

## Research-only references

- OpenRCT2 (GPL-3.0) informed high-level guest-needs, cleanliness, queue, and
  park-rating concepts. No OpenRCT2 code, graphics, sounds, data, names, or
  layouts are included.
- Local CC0 projects were inspected for general input and material-system
  patterns. Parkworks implements its own code and art hierarchy.
