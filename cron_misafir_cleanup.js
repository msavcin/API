// cron_misafir_cleanup.js
// Her ay başında çalıştırılacak: misafir kullanıcısına ait tüm verileri siler.

const { sequelize, User, Campground, CustomChecklist, CommunityMember, Friendship } = require('./src/models');

async function runCleanup() {
  try {
    // 1. misafir kullanıcısının id'sini bul
    const guestUser = await User.findOne({ where: { username: 'misafir' } });
    if (!guestUser) {
      console.log('misafir kullanıcısı bulunamadı.');
      return;
    }
    const guestId = guestUser.id;
    console.log('misafir kullanıcısı id:', guestId);


    // Önce silinecek kayıtları göster
    const campToDelete = await Campground.findAll({ where: { owner_id: guestId } });
    const checklistToDelete = await CustomChecklist.findAll({ where: { user_id: guestId } });
    const commToDelete = await CommunityMember.findAll({ where: { user_id: guestId } });
    const friendToDelete = await Friendship.findAll({ where: { user_id: guestId } });

    console.log('--- Silinecek Campgrounds ---');
    campToDelete.forEach(c => console.log(c.toJSON()));
    console.log('--- Silinecek CustomChecklists ---');
    checklistToDelete.forEach(c => console.log(c.toJSON()));
    console.log('--- Silinecek CommunityMembers ---');
    commToDelete.forEach(c => console.log(c.toJSON()));
    console.log('--- Silinecek Friendships ---');
    friendToDelete.forEach(c => console.log(c.toJSON()));

    // Silme işlemleri
    const campDeleted = await Campground.destroy({ where: { owner_id: guestId } });
    console.log(`Campgrounds silindi: ${campDeleted}`);
    const checklistDeleted = await CustomChecklist.destroy({ where: { user_id: guestId } });
    console.log(`CustomChecklist silindi: ${checklistDeleted}`);
    const commDeleted = await CommunityMember.destroy({ where: { user_id: guestId } });
    console.log(`CommunityMembers silindi: ${commDeleted}`);
    const friendDeleted = await Friendship.destroy({ where: { user_id: guestId } });
    console.log(`Friendships silindi: ${friendDeleted}`);

    // Bağlantıyı kapat
    await sequelize.close();
    console.log('İşlem tamamlandı.');
  } catch (err) {
    console.error('Hata:', err);
    process.exit(1);
  }
}

runCleanup();
