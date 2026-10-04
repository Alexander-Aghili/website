# AtlasProjects

These maps are maintained in separate Git repositories and pinned here as submodules:

- `abandoned-airfields`: [AbandondedAirfieldAtlas](https://github.com/Alexander-Aghili/AbandondedAirfieldAtlas)
- `air-crashes`: [Air-Crash-Atlas](https://github.com/Alexander-Aghili/Air-Crash-Atlas)

Initialize them after cloning the website:

```sh
git submodule update --init --recursive
```

`_plugins/atlas-projects.rb` publishes each repository's `web/` directory at `/abandoned-airfield-atlas/` and `/air-crash-atlas/`. The AtlasProjects project page links to both maps. Extraction pipelines, tests, and backup datasets are not published; vendor licenses and source attribution are retained.

To publish an updated app, update its submodule to a reviewed commit and commit the new submodule pointer in this repository. Site deployment checks out the pinned revisions recursively.
