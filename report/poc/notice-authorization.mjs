export default async function verify(ctx) {
  const { client: author, user } = await ctx.register('notice-author');
  const { client: outsider } = await ctx.register('other-user');
  const original = { title: '공지 권한 검증용 게시글', content: '관리자가 공지로 지정하기 전의 본문입니다.', category: '자유' };
  const created = await author.request('POST', '/api/posts', original);
  ctx.check('일반 작성자가 글 작성', created.status, 201);
  ctx.check('게시글 번호 발급', Number.isSafeInteger(created.body.id), true);
  const path = `/api/posts/${created.body.id}`;
  const promoted = await ctx.admin.request('PATCH', path, { ...original, category: '공지' });
  ctx.check('관리자가 공지 지정', promoted.status, 200);
  const before = await author.request('GET', path);
  ctx.check('공지 지정 후 조회', before.status, 200);
  ctx.check('저장된 공지 상태', before.body.post?.category, '공지');
  ctx.check('원 작성자 유지', before.body.post?.author?.id, user.id);

  const edited = { title: '작성자가 변경한 제목', content: '일반 작성자의 요청으로 본문이 변경되었습니다.', category: '자유' };
  const stranger = await outsider.request('PATCH', path, edited);
  ctx.check('다른 사용자의 수정 거부', stranger.status, 403);
  const keepNotice = await author.request('PATCH', path, { ...edited, category: '공지' });
  ctx.check('원 작성자의 공지 유지 수정 거부', keepNotice.status, 403);
  const unchanged = await author.request('GET', path);
  ctx.check('거부 후 조회', unchanged.status, 200);
  ctx.check('거부된 요청으로 본문이 변하지 않음', unchanged.body.post?.content, original.content);
  ctx.check('거부된 요청으로 공지 상태가 변하지 않음', unchanged.body.post?.category, '공지');

  const changed = await author.request('PATCH', path, edited);
  ctx.check('원 작성자가 자유로 바꾸며 수정', changed.status, 200);
  const after = await author.request('GET', path);
  ctx.check('수정 후 조회', after.status, 200);
  ctx.check('실제 카테고리 변경', after.body.post?.category, edited.category);
  ctx.check('실제 제목 변경', after.body.post?.title, edited.title);
  ctx.check('실제 본문 변경', after.body.post?.content, edited.content);
  ctx.check('작성자는 여전히 일반 사용자', after.body.post?.author?.role, 'user');
}
