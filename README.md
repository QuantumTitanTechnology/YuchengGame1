# Orion: Alien Breach

A browser-based first-person alien shooter set on the stranded spaceship Orion.

The current build uses Three.js from a CDN for real 3D rendering, so the page needs internet access unless you later vendor the library locally.

## Play

Open `index.html` in a browser, or publish the repository with GitHub Pages.

## Controls

- `WASD`: move
- Mouse: aim
- Click or `Space`: fire
- `R`: reload
- `Shift`: sprint

## Publish With GitHub Pages

1. Put these files in a GitHub repository.
2. In the repository settings, open **Pages**.
3. Set the publishing source to **GitHub Actions**.
4. Push to the `main` branch.

The workflow in `.github/workflows/pages.yml` uploads the whole static site and deploys it.
