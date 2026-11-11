/** Match the invite policy for both regular submissions and project workspaces. */
export const canJoinEnterprise = (user: string) =>
  `(NOT t.invite_only OR t.owner_id = ${user} OR ${user} = ANY(t.invite_user_ids)
    OR EXISTS (SELECT 1 FROM users iu WHERE iu.id = ${user} AND iu.email = ANY(t.invite_emails)))`;
