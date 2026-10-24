import { Composition } from "remotion";
import { animatic } from "./data/animatic";
import { engineTest } from "./data/engine-test";
import type { Edit } from "./edit";
import { editDuration, Video } from "./video";

const comp = (id: string, edit: Edit) => (
  <Composition
    component={Video}
    defaultProps={{ edit }}
    durationInFrames={Math.max(1, Math.ceil(editDuration(edit) * edit.fps))}
    fps={edit.fps}
    height={edit.height}
    id={id}
    width={edit.width}
  />
);

export function Root() {
  return (
    <>
      {comp("Animatic", animatic)}
      {comp("EngineTest", engineTest)}
    </>
  );
}
