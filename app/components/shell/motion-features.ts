// Loaded after the shell renders: hover, focus and variant animation for the
// sidebar icons. `domAnimation` covers them; drag and layout features are unused.
// Imported from framer-motion (the package `motion/react` re-exports) so this
// chunk does not also pull in the full `motion` component.
import { domAnimation } from "framer-motion";

export default domAnimation;
