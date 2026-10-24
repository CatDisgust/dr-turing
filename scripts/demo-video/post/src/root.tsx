import { Composition, Still } from "remotion";
import { Cover } from "./cover";
import { animatic, opening } from "./data/animatic";
import { engineTest } from "./data/engine-test";
import { fromTake, MUSIC, shortFromTake } from "./data/take";
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
      {/* 只看开场动画（带音乐、音效），改开场时预览用 */}
      {comp("Opening", { ...animatic, music: MUSIC, shots: [opening] })}
      {fromTake ? comp("Take", fromTake) : null}
      {shortFromTake ? comp("Short", shortFromTake) : null}
      <Still
        component={Cover}
        defaultProps={{ edit: fromTake ?? animatic }}
        height={1080}
        id="Cover"
        width={1920}
      />
    </>
  );
}
