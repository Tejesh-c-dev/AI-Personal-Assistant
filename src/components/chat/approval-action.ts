export function createApprovalActionLock() {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

export async function copyApprovalId(id: string, clipboard: Pick<Clipboard, "writeText">) {
  await clipboard.writeText(id);
}
